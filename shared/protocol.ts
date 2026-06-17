// ---------------------------------------------------------------------------
// Wire protocol. Two kinds of WebSocket frames:
//  - Binary (ArrayBuffer): the hot path — input commands client→server and
//    world snapshots server→client. Encoded little-endian via DataView.
//  - Text (JSON): everything else — join/welcome, kills, beams, scores, pings.
// ---------------------------------------------------------------------------

import { type Vec3, vec3 } from './math';
import type { UserCmd } from './movement';

export const MSG_INPUT = 1;
export const MSG_SNAPSHOT = 2;

// --------------------------- input (client → server) ----------------------

export const INPUT_BYTES = 25;

export function encodeInput(cmd: UserCmd): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG_INPUT);
  dv.setUint32(1, cmd.seq >>> 0, true);
  dv.setUint8(5, Math.min(255, Math.max(1, Math.round(cmd.msec))));
  dv.setInt8(6, cmd.fmove);
  dv.setInt8(7, cmd.smove);
  dv.setUint8(8, cmd.buttons & 0xff);
  dv.setFloat32(9, cmd.yaw, true);
  dv.setFloat32(13, cmd.pitch, true);
  // f64 like snapshot serverTime — a u32 would wrap after ~49.7 days of
  // server uptime and silently pin lag-comp rewinds to the 1s maximum.
  dv.setFloat64(17, cmd.interpTime, true);
  return buf;
}

export function decodeInput(dv: DataView): UserCmd {
  return {
    seq: dv.getUint32(1, true),
    msec: dv.getUint8(5),
    fmove: dv.getInt8(6),
    smove: dv.getInt8(7),
    buttons: dv.getUint8(8),
    yaw: dv.getFloat32(9, true),
    pitch: dv.getFloat32(13, true),
    interpTime: dv.getFloat64(17, true),
  };
}

// ------------------------- snapshot (server → client) ---------------------

export const SNAP_FLAG_ALIVE = 1 << 0;
export const SNAP_FLAG_ONGROUND = 1 << 1;
export const SNAP_FLAG_CROUCHED = 1 << 2;

export interface SnapshotPlayer {
  id: number;
  alive: boolean;
  onGround: boolean;
  crouched: boolean;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  pitch: number;
  teleportCount: number;
  padTouchId: number; // -1 encoded as 255
}

export interface Snapshot {
  /** Server clock in ms when this snapshot was taken. */
  serverTime: number;
  /** Highest input seq the server has processed for the recipient. */
  ackSeq: number;
  players: SnapshotPlayer[];
}

const SNAP_HEADER_BYTES = 1 + 8 + 4 + 1;
const SNAP_PLAYER_BYTES = 1 + 1 + 12 + 12 + 4 + 4 + 1 + 1;

export function encodeSnapshot(snap: Snapshot): ArrayBuffer {
  const buf = new ArrayBuffer(SNAP_HEADER_BYTES + snap.players.length * SNAP_PLAYER_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, MSG_SNAPSHOT);
  dv.setFloat64(1, snap.serverTime, true);
  dv.setUint32(9, snap.ackSeq >>> 0, true);
  dv.setUint8(13, snap.players.length);
  let o = SNAP_HEADER_BYTES;
  for (const p of snap.players) {
    dv.setUint8(o, p.id);
    dv.setUint8(
      o + 1,
      (p.alive ? SNAP_FLAG_ALIVE : 0) |
        (p.onGround ? SNAP_FLAG_ONGROUND : 0) |
        (p.crouched ? SNAP_FLAG_CROUCHED : 0),
    );
    dv.setFloat32(o + 2, p.pos.x, true);
    dv.setFloat32(o + 6, p.pos.y, true);
    dv.setFloat32(o + 10, p.pos.z, true);
    dv.setFloat32(o + 14, p.vel.x, true);
    dv.setFloat32(o + 18, p.vel.y, true);
    dv.setFloat32(o + 22, p.vel.z, true);
    dv.setFloat32(o + 26, p.yaw, true);
    dv.setFloat32(o + 30, p.pitch, true);
    dv.setUint8(o + 34, p.teleportCount & 0xff);
    dv.setUint8(o + 35, p.padTouchId < 0 ? 255 : p.padTouchId & 0xff);
    o += SNAP_PLAYER_BYTES;
  }
  return buf;
}

export function decodeSnapshot(dv: DataView): Snapshot {
  const serverTime = dv.getFloat64(1, true);
  const ackSeq = dv.getUint32(9, true);
  const count = dv.getUint8(13);
  const players: SnapshotPlayer[] = [];
  let o = SNAP_HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const flags = dv.getUint8(o + 1);
    const padRaw = dv.getUint8(o + 35);
    players.push({
      id: dv.getUint8(o),
      alive: (flags & SNAP_FLAG_ALIVE) !== 0,
      onGround: (flags & SNAP_FLAG_ONGROUND) !== 0,
      crouched: (flags & SNAP_FLAG_CROUCHED) !== 0,
      pos: vec3(dv.getFloat32(o + 2, true), dv.getFloat32(o + 6, true), dv.getFloat32(o + 10, true)),
      vel: vec3(dv.getFloat32(o + 14, true), dv.getFloat32(o + 18, true), dv.getFloat32(o + 22, true)),
      yaw: dv.getFloat32(o + 26, true),
      pitch: dv.getFloat32(o + 30, true),
      teleportCount: dv.getUint8(o + 34),
      padTouchId: padRaw === 255 ? -1 : padRaw,
    });
    o += SNAP_PLAYER_BYTES;
  }
  return { serverTime, ackSeq, players };
}

// ------------------------------ JSON messages -----------------------------

export interface PlayerInfo {
  id: number;
  userId: string;
  name: string;
  /** Discord avatar hash, or null (client builds the CDN URL / fallback). */
  avatar: string | null;
  colorIdx: number;
  frags: number;
  deaths: number;
  ping: number;
  /** True while the player is temporarily retained after disconnect. */
  afk: boolean;
}

export type MatchState = 'playing' | 'intermission';

export interface MatchInfo {
  state: MatchState;
  /** Server time (ms) when the match (or intermission) ends. */
  endsAt: number;
  fragLimit: number;
}

export interface Standing {
  id: number;
  name: string;
  colorIdx: number;
  frags: number;
  deaths: number;
}

/** Client → server JSON. */
export type ClientJsonMsg =
  | {
      type: 'join';
      instanceId: string;
      /** Discord user info from authenticate(); used directly only if no token. */
      user: { id: string; username: string; avatar: string | null };
      /** Optional custom display name. Server verifies auth separately and sanitizes this. */
      displayName?: string;
      /** OAuth access token — when present the server verifies identity with Discord. */
      accessToken?: string;
    }
  | { type: 'rename'; name: string }
  | { type: 'ping'; t: number; rtt: number };

/** Server → client JSON. */
export type ServerJsonMsg =
  | {
      type: 'welcome';
      id: number;
      mapName: string;
      serverTime: number;
      match: MatchInfo;
      players: PlayerInfo[];
    }
  | { type: 'playerJoin'; player: PlayerInfo }
  | { type: 'playerUpdate'; player: PlayerInfo }
  | { type: 'playerLeave'; id: number }
  | {
      type: 'beam';
      shooter: number;
      from: [number, number, number];
      to: [number, number, number];
      /** Victim id if the shot killed someone. */
      hit?: number;
    }
  | { type: 'kill'; killer: number; victim: number }
  | { type: 'respawn'; id: number; pos: [number, number, number]; yaw: number }
  | { type: 'scores'; rows: { id: number; frags: number; deaths: number; ping: number }[] }
  | { type: 'matchStart'; match: MatchInfo }
  | { type: 'matchEnd'; standings: Standing[]; restartAt: number }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'error'; code: 'room_full' | 'bad_join' | 'auth_failed'; message: string };

export function vecToArr(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z];
}

export function arrToVec(a: [number, number, number]): Vec3 {
  return vec3(a[0], a[1], a[2]);
}
