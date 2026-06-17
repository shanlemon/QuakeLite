import { WebSocket, type RawData } from 'ws';
import type { ClientJsonMsg } from '../../shared/protocol';
import { resolveJoinIdentity, type Identity } from './identity';
import { getOrCreateRoom, type Player } from './room';
import { rawToString, sendJson } from './wsio';

const JOIN_TIMEOUT_MS = 5000;

type JoinMsg = Extract<ClientJsonMsg, { type: 'join' }>;

export interface ConnectedRoom {
  addPlayer(ws: WebSocket, identity: Identity): Player | null;
  removePlayer(player: Player, opts?: { socket?: WebSocket; immediate?: boolean }): void;
  handleMessage(player: Player, data: RawData, isBinary: boolean): void;
}

export interface ConnectionDeps {
  getRoom?: (instanceId: string) => ConnectedRoom;
  joinTimeoutMs?: number;
  logger?: Pick<typeof console, 'warn'>;
  resolveIdentity?: (msg: JoinMsg) => Promise<Identity | null>;
}

interface ConnectionRuntime {
  getRoom(instanceId: string): ConnectedRoom;
  joinTimeoutMs: number;
  logger: Pick<typeof console, 'warn'>;
  resolveIdentity(msg: JoinMsg): Promise<Identity | null>;
}

function buildRuntime(deps: ConnectionDeps): ConnectionRuntime {
  return {
    getRoom: deps.getRoom ?? getOrCreateRoom,
    joinTimeoutMs: deps.joinTimeoutMs ?? JOIN_TIMEOUT_MS,
    logger: deps.logger ?? console,
    resolveIdentity: deps.resolveIdentity ?? resolveJoinIdentity,
  };
}

/** Build the entry point used for every new WebSocket connection. */
export function createConnectionHandler(deps: ConnectionDeps = {}): (ws: WebSocket) => void {
  const runtime = buildRuntime(deps);

  return (ws: WebSocket): void => {
    let player: Player | null = null;
    let room: ConnectedRoom | null = null;
    let joinReceived = false;
    let closed = false;

    const joinTimeout = setTimeout(() => {
      if (!joinReceived) ws.close(4000, 'join timeout');
    }, runtime.joinTimeoutMs);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      try {
        if (player && room) {
          room.handleMessage(player, data, isBinary);
          return;
        }
        // Pre-join: the only acceptable frame is a JSON 'join'. Binary frames
        // racing the async join verification are silently dropped.
        if (isBinary || joinReceived) return;
        const msg = JSON.parse(rawToString(data)) as ClientJsonMsg;
        if (msg.type !== 'join') return;
        joinReceived = true;
        clearTimeout(joinTimeout);
        void processJoin(ws, msg, runtime)
          .then((result) => {
            if (!result) return;
            if (closed) {
              result.room.removePlayer(result.player, { socket: ws, immediate: true });
              return;
            }
            player = result.player;
            room = result.room;
          })
          .catch((err: unknown) => {
            runtime.logger.warn('[ws] join failed:', err instanceof Error ? err.message : err);
            sendJson(ws, { type: 'error', code: 'bad_join', message: 'Join failed.' });
            ws.close(4002, 'bad join');
          });
      } catch {
        ws.close(4002, 'bad message');
      }
    });

    ws.on('close', () => {
      closed = true;
      clearTimeout(joinTimeout);
      if (player && room) room.removePlayer(player, { socket: ws });
      player = null;
      room = null;
    });

    ws.on('error', (err) => {
      runtime.logger.warn('[ws] socket error:', err.message);
      try {
        ws.terminate();
      } catch {
        /* already dead */
      }
    });
  };
}

/** Production WebSocket entry point; index.ts wires this to the WebSocketServer. */
export const handleConnection = createConnectionHandler();

async function processJoin(
  ws: WebSocket,
  msg: JoinMsg,
  runtime: ConnectionRuntime,
): Promise<{ player: Player; room: ConnectedRoom } | null> {
  const instanceId =
    typeof msg.instanceId === 'string' && msg.instanceId.length > 0
      ? msg.instanceId.slice(0, 128)
      : null;
  if (!instanceId) {
    sendJson(ws, { type: 'error', code: 'bad_join', message: 'Missing instanceId.' });
    ws.close(4002, 'bad join');
    return null;
  }

  const identity = await runtime.resolveIdentity(msg);
  if (!identity) {
    sendJson(ws, { type: 'error', code: 'auth_failed', message: 'Discord authentication failed.' });
    ws.close(4003, 'auth failed');
    return null;
  }

  if (ws.readyState !== WebSocket.OPEN) return null;
  const room = runtime.getRoom(instanceId);
  const player = room.addPlayer(ws, identity); // sends room_full + closes on failure
  return player ? { player, room } : null;
}
