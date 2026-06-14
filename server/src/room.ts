// ---------------------------------------------------------------------------
// Per-Discord-activity-instance room. Owns the player registry, the 60 Hz
// simulation tick (setInterval + accumulator so timer drift never changes the
// tick count), 20 Hz snapshot broadcast, post-join WebSocket message routing,
// and room disposal. The join handshake and identity verification live in
// connection.ts so this module can focus on match state.
// ---------------------------------------------------------------------------

import { WebSocket, type RawData } from 'ws';
import { GAME } from '../../shared/constants';
import { activeMap } from '../../shared/maps';
import { createPmoveState, type UserCmd } from '../../shared/movement';
import { sanitizePlayerName } from '../../shared/playerName';
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
import type { Identity } from './identity';
import { LagCompHistory } from './lagcomp';
import {
  accrueInputBudget,
  enqueueInputCommand,
  initialMsecBudget,
  processInputQueue,
} from './playerInput';
import { rawToString, sendJson, toDataView } from './wsio';

const SCORES_INTERVAL_MS = 1000;
/** Clamp a single timer gap (debugger pause, laptop sleep) to this much sim time. */
const MAX_FRAME_MS = 250;

export interface Player extends GamePlayer {
  ws: WebSocket;
  userId: string;
  defaultName: string;
  avatar: string | null;
  inputQueue: UserCmd[];
  /** Highest input seq processed (acked in snapshots). */
  lastAckSeq: number;
  /** False until the first cmd is processed (so a client may start at seq 0). */
  acked: boolean;
  msecBudget: number;
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
  private readonly map = activeMap;
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
      defaultName: identity.name,
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
      msecBudget: initialMsecBudget(),
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
      enqueueInputCommand(player, cmd);
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
    } else if (msg.type === 'rename') {
      const nextName = sanitizePlayerName(msg.name, player.defaultName);
      if (nextName !== player.name) {
        player.name = nextName;
        this.broadcast({ type: 'playerUpdate', player: playerInfo(player) });
      }
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
    accrueInputBudget(this.players.values(), elapsed);

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
      processInputQueue(p, {
        map: this.map,
        now,
        gameState: this.game.state,
        players: all,
        tryFire: (shooter, cmd, fireNow, players) => this.game.tryFire(shooter, cmd, fireNow, players),
      });
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
