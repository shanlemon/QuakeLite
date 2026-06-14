import { vec3, lerp, lerpAngle, lerpVec, type Vec3 } from '../../shared/math';
import type { SnapshotPlayer } from '../../shared/protocol';

export const INTERP_BUFFER_MS = 1500;
/** Snapshot gaps wider than this are not interpolated across (snap instead). */
export const INTERP_MAX_GAP_MS = 250;

export interface InterpSample {
  t: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  teleportCount: number;
}

export function sampleFromSnapshotPlayer(p: SnapshotPlayer, t: number): InterpSample {
  return {
    t,
    pos: p.pos,
    yaw: p.yaw,
    pitch: p.pitch,
    alive: p.alive,
    teleportCount: p.teleportCount,
  };
}

export function appendInterpSample(buf: InterpSample[], sample: InterpSample): boolean {
  if (buf.length > 0 && sample.t <= buf[buf.length - 1]!.t) return false;
  buf.push(sample);
  return true;
}

export function pruneInterpBuffer(buf: InterpSample[], maxWindowMs = INTERP_BUFFER_MS): void {
  if (buf.length <= 2) return;
  const newestT = buf[buf.length - 1]!.t;
  while (buf.length > 2 && newestT - buf[0]!.t > maxWindowMs) buf.shift();
}

export function sampleInterpBuffer(
  buf: readonly InterpSample[],
  renderTime: number,
  maxGapMs = INTERP_MAX_GAP_MS,
): InterpSample {
  if (buf.length === 0) throw new Error('cannot sample an empty interpolation buffer');

  const newest = buf[buf.length - 1]!;
  if (renderTime >= newest.t) return newest; // hold newest - no extrapolation
  if (renderTime <= buf[0]!.t) return buf[0]!;

  let i = buf.length - 2;
  while (i > 0 && buf[i]!.t > renderTime) i--;
  const a = buf[i]!;
  const b = buf[i + 1]!;

  // Never interpolate across a teleport or a long gap - snap to the newer.
  if (a.teleportCount !== b.teleportCount || b.t - a.t > maxGapMs) return b;

  const t = (renderTime - a.t) / (b.t - a.t);
  return {
    t: renderTime,
    pos: lerpVec(vec3(), a.pos, b.pos, t),
    yaw: lerpAngle(a.yaw, b.yaw, t),
    pitch: lerp(a.pitch, b.pitch, t),
    alive: b.alive,
    teleportCount: b.teleportCount,
  };
}
