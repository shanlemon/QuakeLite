// ---------------------------------------------------------------------------
// Per-Discord-activity-instance room. Owns the player registry, the 60 Hz
// simulation tick (setInterval + accumulator so timer drift never changes the
// tick count), 20 Hz snapshot broadcast, the join handshake (including
// Discord identity verification) and all WebSocket message routing. Rooms
// live in a module-level registry keyed by instanceId and are disposed when
// the last player leaves.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import { GAME } from '../../shared/constants';
import { vortexPortal } from '../../shared/maps/vortexportal';
import { clamp } from '../../shared/math';
import { BUTTON_FIRE, createPmoveState, pmove, type UserCmd } from '../../shared/movement';
import {
  INPUT_BYTES,
  MSG_INPUT,
  decodeInput,
  encodeSnapshot,
  type ClientJsonMsg,
  type PlayerInfo,
  type ServerJsonMsg,
  type SnapshotPlayer,
} from '../../shared/protocol';
import { Game, type GamePlayer } from './game';
import { LagCompHistory } from './lagcomp';

const JOIN_TIMEOUT_MS = 5000;
const INPUT_QUEUE_CAP = 128;
/** Anti-speedhack: budget accrues at 1.25× real time, capped at 400 ms. */
const MSEC_BUDGET_RATE = 1.25;
const MSEC_BUDGET_CAP = 400;
const SCORES_INTERVAL_MS = 1000;
/** Clamp a single timer gap (debugger pause, laptop sleep) to this much sim time. */
const MAX_FRAME_MS = 250;

export interface Player extends GamePlayer {
  ws: WebSocket;
  userId: string;
  avatar: string | null;
  inputQueue: UserCmd[];
  /** Highest input seq processed (acked in snapshots). */
  lastAckSeq: number;
  /** False until the first cmd is processed (so a client may start at seq 0). */
  acked: boolean;
  msecBudget: number;
}

interface Identity {
  userId: string;
  name: string;
  avatar: string | null;
}

const rooms = new Map<string, Room>();

export function getOrCreateRoom(instanceId: string): Room {
  let room = rooms.get(instanceId);
  if (!room) {
    room = new Room(instanceId);
    rooms.set(instanceId, room);
  }
  return room;
}

export class Room {
  readonly players = new Map<number, Player>();
  private readonly map = vortexPortal;
  private readonly game: Game;
  private readonly interval: NodeJS.Timeout;
  private lastLoop = performance.now();
  private accumulator = 0;
  private tickCount = 0;
  private lastScoresAt = performance.now();

  constructor(readonly instanceId: string) {
    this.game = new Game(this.map, (msg) => this.broadcast(msg), performance.now());
    this.interval = setInterval(() => this.loop(), Math.floor(GAME.TICK_MS));
    console.log(`[room ${this.instanceId}] created`);
  }

  /** Returns null (after sending an error + closing the socket) if the room is full. */
  addPlayer(ws: WebSocket, identity: Identity): Player | null {
    if (this.players.size >= GAME.MAX_PLAYERS_PER_ROOM) {
      sendJson(ws, { type: 'error', code: 'room_full', message: 'This match is full.' });
      ws.close(4001, 'room full');
      return null;
    }
    let id = 0;
    while (this.players.has(id)) id++;
    const usedColors = new Set([...this.players.values()].map((p) => p.colorIdx));
    let colorIdx = 0;
    while (usedColors.has(colorIdx)) colorIdx++;

    const player: Player = {
      id,
      ws,
      userId: identity.userId,
      name: identity.name,
      avatar: identity.avatar,
      colorIdx,
      state: createPmoveState(),
      alive: false,
      frags: 0,
      deaths: 0,
      yaw: 0,
      pitch: 0,
      ping: 0,
      nextFireAt: 0,
      respawnAt: null,
      history: new LagCompHistory(),
      inputQueue: [],
      lastAckSeq: 0,
      acked: false,
      // Headroom so the client's first cmds after the welcome aren't dropped.
      msecBudget: MSEC_BUDGET_CAP / 2,
    };
    this.players.set(id, player);

    this.send(player, {
      type: 'welcome',
      id,
      mapName: this.map.name,
      serverTime: performance.now(),
      match: this.game.matchInfo(),
      players: [...this.players.values()].map(playerInfo),
    });
    this.broadcastExcept(player, { type: 'playerJoin', player: playerInfo(player) });
    // Mid-match joins play instantly.
    this.game.spawnPlayer(player, [...this.players.values()]);
    console.log(`[room ${this.instanceId}] ${player.name} joined as #${id} (${this.players.size} players)`);
    return player;
  }

  removePlayer(player: Player): void {
    if (!this.players.delete(player.id)) return;
    this.broadcast({ type: 'playerLeave', id: player.id });
    console.log(`[room ${this.instanceId}] ${player.name} left (${this.players.size} players)`);
    if (this.players.size === 0) this.dispose();
  }

  /** Route one post-join frame. Throws on malformed JSON (caller closes the socket). */
  handleMessage(player: Player, data: RawData, isBinary: boolean): void {
    if (isBinary) {
      const dv = toDataView(data);
      if (!dv || dv.byteLength < INPUT_BYTES || dv.getUint8(0) !== MSG_INPUT) return;
      const cmd = decodeInput(dv);
      if (!Number.isFinite(cmd.yaw) || !Number.isFinite(cmd.pitch)) return;
      if (player.inputQueue.length >= INPUT_QUEUE_CAP) player.inputQueue.shift();
      player.inputQueue.push(cmd);
      return;
    }
    const msg = JSON.parse(rawToString(data)) as ClientJsonMsg;
    if (msg.type === 'ping') {
      if (typeof msg.rtt === 'number' && Number.isFinite(msg.rtt)) {
        player.ping = Math.max(0, Math.min(999, Math.round(msg.rtt)));
      }
      this.send(player, {
        type: 'pong',
        t: typeof msg.t === 'number' ? msg.t : 0,
        serverTime: performance.now(),
      });
    }
    // Duplicate 'join' (or unknown types) after joining: ignored.
  }

  // ------------------------------ simulation ------------------------------

  private loop(): void {
    const now = performance.now();
    let elapsed = now - this.lastLoop;
    this.lastLoop = now;
    if (elapsed < 0) elapsed = 0;
    if (elapsed > MAX_FRAME_MS) elapsed = MAX_FRAME_MS;

    // Budgets accrue with REAL elapsed time regardless of tick batching.
    for (const p of this.players.values()) {
      p.msecBudget = Math.min(MSEC_BUDGET_CAP, p.msecBudget + elapsed * MSEC_BUDGET_RATE);
    }

    this.accumulator += elapsed;
    while (this.accumulator >= GAME.TICK_MS) {
      this.accumulator -= GAME.TICK_MS;
      this.tick();
    }
  }

  private tick(): void {
    this.tickCount++;
    const now = performance.now();
    const all = [...this.players.values()];

    for (const p of all) {
      const queue = p.inputQueue;
      if (queue.length > 0) {
        queue.sort((a, b) => a.seq - b.seq);
        for (const cmd of queue) {
          if (p.acked && cmd.seq <= p.lastAckSeq) continue; // dupe / stale
          p.acked = true;
          p.lastAckSeq = cmd.seq;
          cmd.pitch = clamp(cmd.pitch, -Math.PI / 2, Math.PI / 2);
          p.yaw = cmd.yaw;
          p.pitch = cmd.pitch;
          const msec = clamp(Math.round(cmd.msec), 1, 250);
          if (msec > p.msecBudget) continue; // beyond budget: dropped, but acked
          p.msecBudget -= msec;
          // Dead players and intermission still consume cmds — just no pmove.
          if (this.game.state === 'playing' && p.alive) {
            pmove(p.state, cmd, this.map);
            if (cmd.buttons & BUTTON_FIRE) this.game.tryFire(p, cmd, now, all);
          }
        }
        queue.length = 0;
      }
    }

    this.game.update(now, all);

    // Record lag-comp history after respawns so fresh spawns are queryable.
    for (const p of all) p.history.record(now, p.state.pos, p.alive, p.state.teleportCount);

    if (this.tickCount % GAME.SNAPSHOT_DIVISOR === 0) this.sendSnapshots(now);

    if (now - this.lastScoresAt >= SCORES_INTERVAL_MS) {
      this.lastScoresAt = now;
      this.game.broadcastScores(all);
    }
  }

  private sendSnapshots(now: number): void {
    const players: SnapshotPlayer[] = [...this.players.values()].map((p) => ({
      id: p.id,
      alive: p.alive,
      onGround: p.state.onGround,
      pos: p.state.pos,
      vel: p.state.vel,
      yaw: p.yaw,
      pitch: p.pitch,
      teleportCount: p.state.teleportCount,
      padTouchId: p.state.padTouchId,
    }));
    for (const p of this.players.values()) {
      if (p.ws.readyState !== WebSocket.OPEN) continue;
      p.ws.send(encodeSnapshot({ serverTime: now, ackSeq: p.lastAckSeq, players }));
    }
  }

  // ------------------------------- plumbing -------------------------------

  private send(player: Player, msg: ServerJsonMsg): void {
    sendJson(player.ws, msg);
  }

  private broadcast(msg: ServerJsonMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
  }

  private broadcastExcept(except: Player, msg: ServerJsonMsg): void {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p !== except && p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
    }
  }

  private dispose(): void {
    clearInterval(this.interval);
    rooms.delete(this.instanceId);
    console.log(`[room ${this.instanceId}] empty — disposed (${rooms.size} rooms active)`);
  }
}

// ----------------------------- connection flow -----------------------------

/** Entry point for every new WebSocket — index.ts wires this to the wss. */
export function handleConnection(ws: WebSocket): void {
  let player: Player | null = null;
  let room: Room | null = null;
  let joinReceived = false;
  let closed = false;

  const joinTimeout = setTimeout(() => {
    if (!joinReceived) ws.close(4000, 'join timeout');
  }, JOIN_TIMEOUT_MS);

  ws.on('message', (data: RawData, isBinary: boolean) => {
    try {
      if (player && room) {
        room.handleMessage(player, data, isBinary);
        return;
      }
      // Pre-join: the only acceptable frame is a JSON 'join'. Binary frames
      // racing the (async) join verification are silently dropped.
      if (isBinary || joinReceived) return;
      const msg = JSON.parse(rawToString(data)) as ClientJsonMsg;
      if (msg.type !== 'join') return;
      joinReceived = true;
      clearTimeout(joinTimeout);
      void processJoin(ws, msg)
        .then((result) => {
          if (!result) return;
          if (closed) {
            // Socket died while we were verifying with Discord.
            result.room.removePlayer(result.player);
            return;
          }
          player = result.player;
          room = result.room;
        })
        .catch((err: unknown) => {
          console.warn('[ws] join failed:', err instanceof Error ? err.message : err);
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
    if (player && room) room.removePlayer(player);
    player = null;
    room = null;
  });

  ws.on('error', (err) => {
    console.warn('[ws] socket error:', err.message);
    try {
      ws.terminate();
    } catch {
      /* already dead */
    }
  });
}

async function processJoin(
  ws: WebSocket,
  msg: Extract<ClientJsonMsg, { type: 'join' }>,
): Promise<{ player: Player; room: Room } | null> {
  const instanceId =
    typeof msg.instanceId === 'string' && msg.instanceId.length > 0
      ? msg.instanceId.slice(0, 128)
      : null;
  if (!instanceId) {
    sendJson(ws, { type: 'error', code: 'bad_join', message: 'Missing instanceId.' });
    ws.close(4002, 'bad join');
    return null;
  }

  let identity: Identity;
  if (typeof msg.accessToken === 'string' && msg.accessToken.length > 0) {
    // Verified path: identity comes from Discord, claimed values are ignored.
    const user = await verifyDiscordUser(msg.accessToken);
    if (!user) {
      sendJson(ws, { type: 'error', code: 'auth_failed', message: 'Discord authentication failed.' });
      ws.close(4003, 'auth failed');
      return null;
    }
    identity = { userId: user.id, name: sanitizeName(user.username), avatar: user.avatar };
  } else {
    // Guest path (plain browser / SDK mock): never trust a claimed Discord id.
    identity = {
      userId: 'guest:' + randomUUID().slice(0, 8),
      name: sanitizeName(msg.user?.username),
      avatar: sanitizeAvatar(msg.user?.avatar),
    };
  }

  if (ws.readyState !== WebSocket.OPEN) return null;
  const room = getOrCreateRoom(instanceId);
  const player = room.addPlayer(ws, identity); // sends room_full + closes on failure
  return player ? { player, room } : null;
}

/** GET /users/@me with the player's OAuth token. Null on any failure. */
async function verifyDiscordUser(
  accessToken: string,
): Promise<{ id: string; username: string; avatar: string | null } | null> {
  try {
    const res = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      avatar?: unknown;
    };
    if (typeof u.id !== 'string' || u.id.length === 0) return null;
    const username =
      typeof u.global_name === 'string' && u.global_name.length > 0
        ? u.global_name
        : typeof u.username === 'string'
          ? u.username
          : 'Player';
    return { id: u.id, username, avatar: typeof u.avatar === 'string' ? u.avatar : null };
  } catch {
    return null;
  }
}

// -------------------------------- helpers ----------------------------------

function playerInfo(p: Player): PlayerInfo {
  return {
    id: p.id,
    userId: p.userId,
    name: p.name,
    avatar: p.avatar,
    colorIdx: p.colorIdx,
    frags: p.frags,
    deaths: p.deaths,
    ping: p.ping,
  };
}

function sendJson(ws: WebSocket, msg: ServerJsonMsg): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  // Strip control characters, collapse whitespace, cap at 24 chars.
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Player';
}

/** Guests can only carry an avatar that looks like a Discord avatar hash. */
function sanitizeAvatar(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-z0-9_]{4,64}$/i.test(raw) ? raw : null;
}

function rawToString(data: RawData): string {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function toDataView(data: RawData): DataView | null {
  if (data instanceof ArrayBuffer) return new DataView(data);
  if (Array.isArray(data)) {
    const buf = Buffer.concat(data);
    return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  if (Buffer.isBuffer(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength);
  return null;
}
