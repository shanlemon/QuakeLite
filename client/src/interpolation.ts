import { vec3, lerp, lerpAngle, lerpVec, type Vec3 } from '../../shared/math';
import type { SnapshotPlayer } from '../../shared/protocol';

export const INTERP_BUFFER_MS = 1500;
/** Snapshot gaps wider than this are not interpolated across (snap instead). */
export const INTERP_MAX_GAP_MS = 250;
export const INTERP_DELAY_MAX_MS = 240;

const DELAY_RISE_ALPHA = 0.45;
const DELAY_FALL_ALPHA = 0.04;
const INTERVAL_EMA = 0.12;
const JITTER_RISE_EMA = 0.35;
const JITTER_FALL_EMA = 0.08;
const MAX_REASONABLE_GAP_MS = 1000;

export interface InterpDelayState {
  baseDelayMs: number;
  maxDelayMs: number;
  delayMs: number;
  intervalMs: number;
  jitterMs: number;
  lastServerTime: number | null;
  lastArrivalTime: number | null;
}

export interface InterpSample {
  t: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  crouched: boolean;
  teleportCount: number;
}

export function createInterpDelayState(baseDelayMs: number, maxDelayMs = INTERP_DELAY_MAX_MS): InterpDelayState {
  return {
    baseDelayMs,
    maxDelayMs: Math.max(baseDelayMs, maxDelayMs),
    delayMs: baseDelayMs,
    intervalMs: 0,
    jitterMs: 0,
    lastServerTime: null,
    lastArrivalTime: null,
  };
}

function ema(current: number, sample: number, alpha: number): number {
  return current === 0 ? sample : current + (sample - current) * alpha;
}

export function updateInterpDelay(state: InterpDelayState, serverTime: number, arrivalTime: number): number {
  const lastServerTime = state.lastServerTime;
  const lastArrivalTime = state.lastArrivalTime;
  state.lastServerTime = serverTime;
  state.lastArrivalTime = arrivalTime;

  if (lastServerTime === null || lastArrivalTime === null) return state.delayMs;

  const serverGap = serverTime - lastServerTime;
  const arrivalGap = arrivalTime - lastArrivalTime;
  if (
    serverGap <= 0 ||
    arrivalGap <= 0 ||
    serverGap > MAX_REASONABLE_GAP_MS ||
    arrivalGap > MAX_REASONABLE_GAP_MS
  ) {
    return state.delayMs;
  }

  state.intervalMs = ema(state.intervalMs, serverGap, INTERVAL_EMA);
  const jitterSample = Math.abs(arrivalGap - serverGap);
  state.jitterMs = ema(
    state.jitterMs,
    jitterSample,
    jitterSample > state.jitterMs ? JITTER_RISE_EMA : JITTER_FALL_EMA,
  );

  const droppedSnapshotPad = Math.max(0, serverGap - state.intervalMs);
  const target = Math.min(
    state.maxDelayMs,
    Math.max(state.baseDelayMs, state.baseDelayMs + state.jitterMs * 3 + droppedSnapshotPad),
  );
  const alpha = target > state.delayMs ? DELAY_RISE_ALPHA : DELAY_FALL_ALPHA;
  state.delayMs += (target - state.delayMs) * alpha;
  if (Math.abs(state.delayMs - target) < 0.25) state.delayMs = target;
  return state.delayMs;
}

export function sampleFromSnapshotPlayer(p: SnapshotPlayer, t: number): InterpSample {
  return {
    t,
    pos: p.pos,
    yaw: p.yaw,
    pitch: p.pitch,
    alive: p.alive,
    crouched: p.crouched,
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
    crouched: b.crouched,
    teleportCount: b.teleportCount,
  };
}
