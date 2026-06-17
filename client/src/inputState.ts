import { clamp, wrapAngle, DEG2RAD } from '../../shared/math';
import { BUTTON_FIRE, BUTTON_JUMP } from '../../shared/movement';

export interface InputSample {
  fmove: number;
  smove: number;
  /** Raw held buttons (jump|fire) - the game gates fire on its cooldown. */
  buttons: number;
  yaw: number;
  pitch: number;
}

export interface HeldInputState {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  fire: boolean;
  /** Local-only camera zoom; not encoded into network command buttons. */
  zoom: boolean;
}

export interface InputView {
  yaw: number;
  pitch: number;
}

export interface TouchStickInput {
  x: number;
  y: number;
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export type ControlModeOverride = 'desktop' | 'touch' | null;

export interface TouchControlCapabilities {
  maxTouchPoints: number;
  pointerCoarse: boolean;
  anyPointerFine: boolean;
  anyHover: boolean;
  override?: ControlModeOverride;
}

export const PITCH_LIMIT = 89 * DEG2RAD;
export const SENSITIVITY_MIN = 0.05;
export const SENSITIVITY_MAX = 20;

export function createHeldInputState(): HeldInputState {
  return {
    fwd: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    fire: false,
    zoom: false,
  };
}

export function clearHeldInput(state: HeldInputState): void {
  state.fwd = false;
  state.back = false;
  state.left = false;
  state.right = false;
  state.jump = false;
  state.fire = false;
  state.zoom = false;
}

export function buildInputSample(state: HeldInputState, view: InputView): InputSample {
  const fmove = (state.fwd ? 127 : 0) + (state.back ? -127 : 0);
  const smove = (state.right ? 127 : 0) + (state.left ? -127 : 0);
  const buttons = (state.jump ? BUTTON_JUMP : 0) | (state.fire ? BUTTON_FIRE : 0);
  return { fmove, smove, buttons, yaw: view.yaw, pitch: view.pitch };
}

export function normalizeSensitivity(value: number): number {
  return clamp(value, SENSITIVITY_MIN, SENSITIVITY_MAX);
}

export function applyLookDelta(
  view: InputView,
  dx: number,
  dy: number,
  sensitivity: number,
  factor: number,
  pitchLimit = PITCH_LIMIT,
): InputView {
  return {
    yaw: wrapAngle(view.yaw - dx * sensitivity * factor),
    pitch: clamp(view.pitch - dy * sensitivity * factor, -pitchLimit, pitchLimit),
  };
}

export function addYawAngle(view: InputView, delta: number): InputView {
  return { yaw: wrapAngle(view.yaw + delta), pitch: view.pitch };
}

export function setViewAngles(yaw: number, pitch: number, pitchLimit = PITCH_LIMIT): InputView {
  return {
    yaw: wrapAngle(yaw),
    pitch: clamp(pitch, -pitchLimit, pitchLimit),
  };
}

export function resolveTouchStick(rawX: number, rawY: number, radius: number, deadzone: number): TouchStickInput {
  const usableRadius = Math.max(1, radius);
  const len = Math.hypot(rawX, rawY);
  const clampedLen = Math.min(usableRadius, len);
  const nx = len > 0 ? rawX / len : 0;
  const ny = len > 0 ? rawY / len : 0;
  const x = nx * clampedLen;
  const y = ny * clampedLen;
  const mx = x / usableRadius;
  const my = y / usableRadius;
  return {
    x,
    y,
    fwd: my < -deadzone,
    back: my > deadzone,
    left: mx < -deadzone,
    right: mx > deadzone,
  };
}

export function parseControlModeOverride(search: string): ControlModeOverride {
  const params = new URLSearchParams(search);
  const raw = (params.get('controls') ?? params.get('input') ?? '').toLowerCase();
  if (raw === 'desktop' || raw === 'mouse' || raw === 'pc') return 'desktop';
  if (raw === 'touch' || raw === 'mobile') return 'touch';
  return null;
}

export function shouldUseTouchControls(capabilities: TouchControlCapabilities): boolean {
  if (capabilities.override === 'desktop') return false;
  if (capabilities.override === 'touch') return true;

  // Touchscreen Windows laptops often report maxTouchPoints > 0 while still
  // having a precise mouse/trackpad. Prefer desktop controls when a fine or
  // hover-capable pointer is present.
  if (capabilities.anyPointerFine || capabilities.anyHover) return false;

  return capabilities.pointerCoarse || capabilities.maxTouchPoints > 0;
}
