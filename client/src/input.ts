// ---------------------------------------------------------------------------
// Pointer-lock mouse look + WASD/Space/fire key state. The browser exits
// pointer lock on Esc by itself — we just observe pointerlockchange and tell
// the game (which shows the pause overlay). All keys are zeroed on unlock so
// the player never runs off while paused.
//
// Sign conventions (matching shared/math): yaw 0 faces -Z and positive yaw
// turns LEFT (counterclockwise from above), so mouse-right (positive
// movementX) must DECREASE yaw. Positive pitch looks up and mouse-up is
// negative movementY, so pitch also decreases by movementY.
// ---------------------------------------------------------------------------

import { clamp, wrapAngle, DEG2RAD } from '../../shared/math';
import { BUTTON_FIRE, BUTTON_JUMP } from '../../shared/movement';

export interface InputSample {
  fmove: number;
  smove: number;
  /** Raw held buttons (jump|fire) — the game gates fire on its cooldown. */
  buttons: number;
  yaw: number;
  pitch: number;
}

export interface InputHooks {
  onLockChange(locked: boolean): void;
  onScoreboard(visible: boolean): void;
  /** Fired on any click on the game surface — resume the audio context here. */
  onInteract(): void;
}

export interface InputSys {
  sample(): InputSample;
  setSensitivity(s: number): void;
  getYaw(): number;
  getPitch(): number;
  /** Rotate the view (portal traversal reorientation). */
  addYaw(delta: number): void;
  /** Hard-set the view (respawn). */
  setView(yaw: number, pitch: number): void;
  isLocked(): boolean;
  requestLock(): void;
  dispose(): void;
}

const PITCH_LIMIT = 89 * DEG2RAD;
/** Radians of view rotation per mouse count at sensitivity 1. */
const SENS_FACTOR = 0.0011;

export function createInput(el: HTMLElement, hooks: InputHooks): InputSys {
  let yaw = 0;
  let pitch = 0;
  let sens = 2;
  let locked = false;

  let fwd = false;
  let back = false;
  let left = false;
  let right = false;
  let jump = false;
  let fire = false;

  const zeroKeys = (): void => {
    fwd = back = left = right = jump = fire = false;
  };

  const requestLock = (): void => {
    // A lock request can legitimately fail (window unfocused, rapid Esc) —
    // swallow the rejection or it lands in the console as an uncaught error.
    const plainRequest = (): void => {
      try {
        const q = el.requestPointerLock() as unknown as Promise<void> | undefined;
        if (q && typeof q.catch === 'function') q.catch(() => {});
      } catch {
        /* ignore */
      }
    };
    // unadjustedMovement = raw input (no OS mouse acceleration) where
    // supported; fall back to a plain request when the option is rejected.
    try {
      const p = el.requestPointerLock({ unadjustedMovement: true }) as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') {
        p.catch(plainRequest);
      }
    } catch {
      plainRequest();
    }
  };

  const onClick = (): void => {
    hooks.onInteract();
    if (!locked) requestLock();
  };

  const onLockChange = (): void => {
    locked = document.pointerLockElement === el;
    if (!locked) zeroKeys();
    hooks.onLockChange(locked);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!locked) return;
    yaw = wrapAngle(yaw - e.movementX * sens * SENS_FACTOR);
    pitch = clamp(pitch - e.movementY * sens * SENS_FACTOR, -PITCH_LIMIT, PITCH_LIMIT);
  };

  const onMouseButton = (e: MouseEvent, down: boolean): void => {
    if (e.button === 0 && locked) fire = down;
  };
  const onMouseDown = (e: MouseEvent): void => onMouseButton(e, true);
  const onMouseUp = (e: MouseEvent): void => onMouseButton(e, false);

  const onKey = (e: KeyboardEvent, down: boolean): void => {
    if (e.code === 'Tab') {
      // Hold-to-show scoreboard; never let Tab move browser focus.
      e.preventDefault();
      if (!e.repeat) hooks.onScoreboard(down);
      return;
    }
    if (!locked) return;
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        fwd = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        right = down;
        break;
      case 'Space':
        jump = down;
        break;
      default:
        return;
    }
    e.preventDefault();
  };
  const onKeyDown = (e: KeyboardEvent): void => onKey(e, true);
  const onKeyUp = (e: KeyboardEvent): void => onKey(e, false);

  const onBlur = (): void => {
    // Alt-tab mid-hold would otherwise leave keys (and the scoreboard) stuck.
    zeroKeys();
    hooks.onScoreboard(false);
  };

  const onContextMenu = (e: Event): void => e.preventDefault();

  el.addEventListener('click', onClick);
  el.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return {
    sample(): InputSample {
      const fmove = (fwd ? 127 : 0) + (back ? -127 : 0);
      const smove = (right ? 127 : 0) + (left ? -127 : 0);
      const buttons = (jump ? BUTTON_JUMP : 0) | (fire ? BUTTON_FIRE : 0);
      return { fmove, smove, buttons, yaw, pitch };
    },
    setSensitivity(s: number): void {
      sens = clamp(s, 0.05, 20);
    },
    getYaw(): number {
      return yaw;
    },
    getPitch(): number {
      return pitch;
    },
    addYaw(delta: number): void {
      yaw = wrapAngle(yaw + delta);
    },
    setView(newYaw: number, newPitch: number): void {
      yaw = wrapAngle(newYaw);
      pitch = clamp(newPitch, -PITCH_LIMIT, PITCH_LIMIT);
    },
    isLocked(): boolean {
      return locked;
    },
    requestLock,
    dispose(): void {
      el.removeEventListener('click', onClick);
      el.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    },
  };
}
