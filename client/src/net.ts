// ---------------------------------------------------------------------------
// WebSocket client. Binary frames are the hot path (input out, snapshots in);
// everything else is JSON. Also owns clock sync: an EMA of offset samples
// taken from ping/pong round trips and from snapshot server timestamps, so
// estServerTime() can place the remote-interpolation render time.
// ---------------------------------------------------------------------------

import {
  MSG_SNAPSHOT,
  decodeSnapshot,
  encodeInput,
  type ClientJsonMsg,
  type ServerJsonMsg,
  type Snapshot,
} from '../../shared/protocol';
import type { UserCmd } from '../../shared/movement';
import type { DiscordContext } from './discord';

export interface NetCallbacks {
  onSnapshot(snap: Snapshot): void;
  /** Every server JSON message except pong (handled internally). */
  onMessage(msg: ServerJsonMsg): void;
  onDisconnect(): void;
}

export interface NetClient {
  sendInput(cmd: UserCmd): void;
  sendName(name: string): void;
  /** Estimated current server clock in ms (smoothed). */
  estServerTime(): number;
  /** Latest measured round-trip time in ms. */
  getRtt(): number;
  close(): void;
}

const PING_INTERVAL_MS = 2000;
const OFFSET_EMA = 0.2;

/** Resolves once the socket is open and the join message has been sent. */
export function connectNet(ctx: DiscordContext, cb: NetCallbacks, displayName = ''): Promise<NetClient> {
  return new Promise<NetClient>((resolve, reject) => {
    // Inside Discord all traffic must traverse the activity proxy.
    const url = ctx.isDiscord
      ? `wss://${location.host}/.proxy/ws`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    let rtt = 0;
    let offset = 0;
    let hasOffset = false;
    let opened = false;
    let pingTimer: number | undefined;

    const sampleOffset = (serverTime: number): void => {
      const sample = serverTime + rtt / 2 - performance.now();
      offset = hasOffset ? offset + (sample - offset) * OFFSET_EMA : sample;
      hasOffset = true;
    };

    const sendJson = (msg: ClientJsonMsg): void => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };
    const sendPing = (): void => sendJson({ type: 'ping', t: performance.now(), rtt });

    const client: NetClient = {
      sendInput(cmd: UserCmd): void {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput(cmd));
      },
      sendName(name: string): void {
        sendJson({ type: 'rename', name });
      },
      estServerTime(): number {
        return performance.now() + offset;
      },
      getRtt(): number {
        return rtt;
      },
      close(): void {
        ws.close();
      },
    };

    ws.onopen = () => {
      opened = true;
      sendJson({
        type: 'join',
        instanceId: ctx.instanceId,
        user: ctx.user,
        ...(displayName ? { displayName } : {}),
        accessToken: ctx.accessToken,
      });
      sendPing(); // sync the clock ASAP rather than waiting for the interval
      pingTimer = window.setInterval(sendPing, PING_INTERVAL_MS);
      resolve(client);
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        const dv = new DataView(ev.data);
        if (dv.byteLength > 0 && dv.getUint8(0) === MSG_SNAPSHOT) {
          const snap = decodeSnapshot(dv);
          // Snapshots double as cheap clock samples (20 Hz vs 0.5 Hz pings).
          sampleOffset(snap.serverTime);
          cb.onSnapshot(snap);
        }
        return;
      }
      let msg: ServerJsonMsg;
      try {
        msg = JSON.parse(ev.data as string) as ServerJsonMsg;
      } catch {
        return;
      }
      if (msg.type === 'pong') {
        rtt = performance.now() - msg.t;
        sampleOffset(msg.serverTime);
        return;
      }
      cb.onMessage(msg);
    };

    ws.onclose = () => {
      if (pingTimer !== undefined) window.clearInterval(pingTimer);
      if (!opened) reject(new Error('Could not connect to the game server'));
      else cb.onDisconnect();
    };

    // Errors are always followed by close; nothing extra to do here.
    ws.onerror = () => {};
  });
}
