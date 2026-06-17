// ---------------------------------------------------------------------------
// Desktop pointer-lock mouse look + WASD/Space/fire input, with a mobile touch
// layer that produces the same InputSample contract. On phones/tablets we
// emulate the game's "locked" state after the first tap because pointer lock
// is not available or useful there.
// ---------------------------------------------------------------------------

import {
  addYawAngle,
  applyLookDelta,
  buildInputSample,
  clearHeldInput,
  createHeldInputState,
  normalizeSensitivity,
  parseControlModeOverride,
  resolveTouchStick,
  setViewAngles,
  shouldUseTouchControls,
  type InputSample,
  type InputView,
} from './inputState';

export type { InputSample } from './inputState';

export interface InputHooks {
  onLockChange(locked: boolean): void;
  onScoreboard(visible: boolean): void;
  /** Fired on any click/tap on the game surface - resume the audio context here. */
  onInteract(): void;
}

export interface InputSys {
  sample(): InputSample;
  setSensitivity(s: number): void;
  getYaw(): number;
  getPitch(): number;
  isZooming(): boolean;
  isTouchMode(): boolean;
  /** Rotate the view (portal traversal reorientation). */
  addYaw(delta: number): void;
  /** Hard-set the view (respawn). */
  setView(yaw: number, pitch: number): void;
  isLocked(): boolean;
  requestLock(): void;
  dispose(): void;
}

/** Radians of view rotation per mouse count at sensitivity 1. */
const SENS_FACTOR = 0.0011;
const TOUCH_LOOK_FACTOR = 0.0032;
const STICK_RADIUS = 58;
const STICK_DEADZONE = 0.16;
const MAX_TOUCH_LOOK_DELTA = 80;

const TOUCH_CSS = `
.ql-touch-controls{position:absolute;inset:0;z-index:6;pointer-events:none;touch-action:none;
  -webkit-user-select:none;user-select:none;font-family:'Rajdhani','Segoe UI',Consolas,'Courier New',monospace;}
.ql-touch-controls.hidden{display:none;}
.ql-touch-move{position:absolute;left:0;top:0;bottom:0;width:42%;pointer-events:auto;touch-action:none;}
.ql-touch-stick{position:absolute;display:none;width:124px;height:124px;margin:-62px 0 0 -62px;border-radius:50%;
  border:1px solid rgba(150,210,235,0.55);
  background:radial-gradient(circle at 50% 50%,rgba(70,230,255,0.14),rgba(5,10,20,0.34));
  box-shadow:0 0 18px rgba(0,0,0,0.35);pointer-events:none;touch-action:none;}
.ql-touch-stick-knob{position:absolute;left:50%;top:50%;width:54px;height:54px;border-radius:50%;
  transform:translate(-50%,-50%);border:1px solid rgba(220,250,255,0.75);
  background:rgba(70,230,255,0.28);box-shadow:0 0 16px rgba(70,230,255,0.22);}
.ql-touch-look{position:absolute;right:0;top:0;width:58%;height:100%;pointer-events:auto;touch-action:none;}
.ql-touch-actions{position:absolute;inset:0;pointer-events:none;}
.ql-touch-btn{position:absolute;pointer-events:auto;touch-action:none;width:68px;height:68px;border-radius:50%;border:1px solid rgba(180,235,255,0.68);
  color:#eaffff;background:rgba(5,10,20,0.38);font:800 14px/1 'Rajdhani','Segoe UI',sans-serif;
  letter-spacing:0;text-shadow:0 1px 2px rgba(0,0,0,0.8);box-shadow:0 0 18px rgba(0,0,0,0.25);padding:0;}
.ql-touch-btn:active,.ql-touch-btn.active{background:rgba(70,230,255,0.34);box-shadow:0 0 20px rgba(70,230,255,0.35);}
.ql-touch-fire{right:max(22px,env(safe-area-inset-right));bottom:max(76px,calc(env(safe-area-inset-bottom) + 76px));
  width:92px;height:92px;border-color:rgba(255,120,120,0.75);background:rgba(70,10,20,0.38);font-size:15px;}
.ql-touch-jump{right:max(128px,calc(env(safe-area-inset-right) + 128px));bottom:max(24px,calc(env(safe-area-inset-bottom) + 24px));}
.ql-touch-score{right:max(128px,calc(env(safe-area-inset-right) + 128px));bottom:max(128px,calc(env(safe-area-inset-bottom) + 128px));}
@media (max-width:760px),(pointer:coarse){
  .ql-touch-stick{width:118px;height:118px;margin:-59px 0 0 -59px;}
  .ql-touch-btn{width:62px;height:62px;font-size:12px;}
  .ql-touch-fire{right:max(18px,env(safe-area-inset-right));bottom:max(74px,calc(env(safe-area-inset-bottom) + 74px));
    width:86px;height:86px;}
  .ql-touch-jump{right:max(116px,calc(env(safe-area-inset-right) + 116px));bottom:max(22px,calc(env(safe-area-inset-bottom) + 22px));}
  .ql-touch-score{right:max(116px,calc(env(safe-area-inset-right) + 116px));bottom:max(118px,calc(env(safe-area-inset-bottom) + 118px));}
}
`;

function supportsTouch(): boolean {
  const mediaMatches = (query: string): boolean => window.matchMedia?.(query).matches === true;
  return shouldUseTouchControls({
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    pointerCoarse: mediaMatches('(pointer: coarse)'),
    anyPointerFine: mediaMatches('(any-pointer: fine)'),
    anyHover: mediaMatches('(any-hover: hover)') || mediaMatches('(hover: hover)'),
    override: parseControlModeOverride(window.location.search),
  });
}

export function createInput(el: HTMLElement, hooks: InputHooks): InputSys {
  let view: InputView = { yaw: 0, pitch: 0 };
  let sens = 2;
  let locked = false;
  const touchMode = supportsTouch();
  const held = createHeldInputState();

  let touchControls: HTMLElement | null = null;
  let stickEl: HTMLElement | null = null;
  let stickKnob: HTMLElement | null = null;
  let movePointer: number | null = null;
  let stickCenterX = 0;
  let stickCenterY = 0;
  let lookPointer: number | null = null;
  let lookLastX = 0;
  let lookLastY = 0;
  let firePointer: number | null = null;
  let fireLastX = 0;
  let fireLastY = 0;
  let fireButtonEl: HTMLButtonElement | null = null;

  const zeroKeys = (): void => {
    clearHeldInput(held);
    resetTouchControls();
  };

  const requestLock = (): void => {
    if (touchMode) {
      locked = true;
      touchControls?.classList.remove('hidden');
      hooks.onLockChange(true);
      return;
    }

    // A lock request can legitimately fail (window unfocused, rapid Esc) -
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
    if (!locked && !touchMode) requestLock();
  };

  const onPointerDown = (): void => {
    if (!touchMode) return;
    hooks.onInteract();
    if (!locked) requestLock();
  };

  const onLockChange = (): void => {
    if (touchMode) return;
    locked = document.pointerLockElement === el;
    if (!locked) zeroKeys();
    hooks.onLockChange(locked);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (!locked || touchMode) return;
    view = applyLookDelta(view, e.movementX, e.movementY, sens, SENS_FACTOR);
  };

  const onMouseButton = (e: MouseEvent, down: boolean): void => {
    if (touchMode) return;
    if (!locked) return;
    if (e.button === 0) held.fire = down;
    if (e.button === 2) held.zoom = down;
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
        held.fwd = down;
        break;
      case 'KeyS':
      case 'ArrowDown':
        held.back = down;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        held.left = down;
        break;
      case 'KeyD':
      case 'ArrowRight':
        held.right = down;
        break;
      case 'Space':
        held.jump = down;
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

  const stopPointer = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation();
  };

  const capturePointer = (target: HTMLElement, pointerId: number): void => {
    try {
      target.setPointerCapture(pointerId);
    } catch {
      /* synthetic events and some cancelled streams cannot be captured */
    }
  };

  const clampTouchDelta = (delta: number): number => (
    Math.max(-MAX_TOUCH_LOOK_DELTA, Math.min(MAX_TOUCH_LOOK_DELTA, delta))
  );

  const applyTouchLook = (dx: number, dy: number): void => {
    view = applyLookDelta(view, clampTouchDelta(dx), clampTouchDelta(dy), sens, TOUCH_LOOK_FACTOR);
  };

  function resetStick(): void {
    if (stickKnob) stickKnob.style.transform = 'translate(-50%,-50%)';
    if (stickEl) stickEl.style.display = 'none';
  }

  function resetTouchControls(): void {
    movePointer = null;
    lookPointer = null;
    firePointer = null;
    resetStick();
    fireButtonEl?.classList.remove('active');
    touchControls?.querySelectorAll('.ql-touch-btn.active').forEach((button) => {
      button.classList.remove('active');
    });
  }

  const setStick = (clientX: number, clientY: number): void => {
    if (!stickEl || !stickKnob) return;
    const rawX = clientX - stickCenterX;
    const rawY = clientY - stickCenterY;
    const stick = resolveTouchStick(rawX, rawY, STICK_RADIUS, STICK_DEADZONE);
    const { x, y } = stick;
    stickKnob.style.transform = `translate(calc(-50% + ${x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px))`;
    held.fwd = stick.fwd;
    held.back = stick.back;
    held.left = stick.left;
    held.right = stick.right;
  };

  const onStickDown = (e: PointerEvent): void => {
    if (!touchMode || !locked || movePointer !== null) return;
    stopPointer(e);
    movePointer = e.pointerId;
    stickCenterX = e.clientX;
    stickCenterY = e.clientY;
    if (stickEl) {
      const r = touchControls?.getBoundingClientRect();
      stickEl.style.left = `${e.clientX - (r?.left ?? 0)}px`;
      stickEl.style.top = `${e.clientY - (r?.top ?? 0)}px`;
      stickEl.style.display = 'block';
    }
    capturePointer(e.currentTarget as HTMLElement, e.pointerId);
    setStick(e.clientX, e.clientY);
  };
  const onStickMove = (e: PointerEvent): void => {
    if (e.pointerId !== movePointer) return;
    stopPointer(e);
    setStick(e.clientX, e.clientY);
  };
  const onStickUp = (e: PointerEvent): void => {
    if (e.pointerId !== movePointer) return;
    stopPointer(e);
    movePointer = null;
    held.fwd = false;
    held.back = false;
    held.left = false;
    held.right = false;
    resetStick();
  };

  const onLookDown = (e: PointerEvent): void => {
    if (!touchMode || !locked || lookPointer !== null) return;
    stopPointer(e);
    lookPointer = e.pointerId;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    capturePointer(e.currentTarget as HTMLElement, e.pointerId);
  };
  const onLookMove = (e: PointerEvent): void => {
    if (e.pointerId !== lookPointer) return;
    stopPointer(e);
    const dx = e.clientX - lookLastX;
    const dy = e.clientY - lookLastY;
    lookLastX = e.clientX;
    lookLastY = e.clientY;
    applyTouchLook(dx, dy);
  };
  const onLookUp = (e: PointerEvent): void => {
    if (e.pointerId !== lookPointer) return;
    stopPointer(e);
    lookPointer = null;
  };

  const onFireDown = (e: PointerEvent): void => {
    if (!touchMode || !locked || firePointer !== null) return;
    stopPointer(e);
    firePointer = e.pointerId;
    fireLastX = e.clientX;
    fireLastY = e.clientY;
    held.fire = true;
    fireButtonEl = e.currentTarget as HTMLButtonElement;
    fireButtonEl.classList.add('active');
    capturePointer(fireButtonEl, e.pointerId);
  };
  const onFireMove = (e: PointerEvent): void => {
    if (e.pointerId !== firePointer) return;
    stopPointer(e);
    const dx = e.clientX - fireLastX;
    const dy = e.clientY - fireLastY;
    fireLastX = e.clientX;
    fireLastY = e.clientY;
    applyTouchLook(dx, dy);
  };
  const onFireUp = (e: PointerEvent): void => {
    if (e.pointerId !== firePointer) return;
    stopPointer(e);
    releaseFire();
  };

  const releaseFire = (): void => {
    firePointer = null;
    held.fire = false;
    fireButtonEl?.classList.remove('active');
  };

  const onTouchPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId === movePointer) onStickUp(e);
    if (e.pointerId === lookPointer) onLookUp(e);
    if (e.pointerId === firePointer) onFireUp(e);
  };

  const bindTouchButton = (
    button: HTMLButtonElement,
    setDown: (down: boolean) => void,
    opts: { holdScoreboard?: boolean } = {},
  ): void => {
    let pointerId: number | null = null;
    const down = (e: PointerEvent): void => {
      if (!touchMode || !locked || (pointerId !== null && button.classList.contains('active'))) return;
      stopPointer(e);
      pointerId = e.pointerId;
      button.classList.add('active');
      capturePointer(button, e.pointerId);
      setDown(true);
      if (opts.holdScoreboard) hooks.onScoreboard(true);
    };
    const up = (e: PointerEvent): void => {
      if (pointerId !== null && e.pointerId !== pointerId) return;
      stopPointer(e);
      pointerId = null;
      button.classList.remove('active');
      setDown(false);
      if (opts.holdScoreboard) hooks.onScoreboard(false);
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
  };

  if (touchMode) {
    if (!document.getElementById('ql-touch-style')) {
      const style = document.createElement('style');
      style.id = 'ql-touch-style';
      style.textContent = TOUCH_CSS;
      document.head.appendChild(style);
    }
    el.style.touchAction = 'none';

    touchControls = document.createElement('div');
    touchControls.className = 'ql-touch-controls hidden';
    touchControls.setAttribute('aria-hidden', 'true');

    const moveEl = document.createElement('div');
    moveEl.className = 'ql-touch-move';
    touchControls.appendChild(moveEl);

    stickEl = document.createElement('div');
    stickEl.className = 'ql-touch-stick';
    stickKnob = document.createElement('div');
    stickKnob.className = 'ql-touch-stick-knob';
    stickEl.appendChild(stickKnob);
    moveEl.appendChild(stickEl);

    const lookEl = document.createElement('div');
    lookEl.className = 'ql-touch-look';
    touchControls.appendChild(lookEl);

    const actions = document.createElement('div');
    actions.className = 'ql-touch-actions';
    const scoreBtn = document.createElement('button');
    scoreBtn.type = 'button';
    scoreBtn.className = 'ql-touch-btn ql-touch-score';
    scoreBtn.textContent = 'SCORE';
    const jumpBtn = document.createElement('button');
    jumpBtn.type = 'button';
    jumpBtn.className = 'ql-touch-btn ql-touch-jump';
    jumpBtn.textContent = 'JUMP';
    const fireBtn = document.createElement('button');
    fireBtn.type = 'button';
    fireBtn.className = 'ql-touch-btn ql-touch-fire';
    fireBtn.textContent = 'FIRE';
    actions.append(scoreBtn, jumpBtn, fireBtn);
    touchControls.appendChild(actions);
    el.appendChild(touchControls);

    document.addEventListener('pointerup', onTouchPointerEnd);
    document.addEventListener('pointercancel', onTouchPointerEnd);
    moveEl.addEventListener('pointerdown', onStickDown);
    moveEl.addEventListener('pointermove', onStickMove);
    moveEl.addEventListener('pointerup', onStickUp);
    moveEl.addEventListener('pointercancel', onStickUp);
    moveEl.addEventListener('lostpointercapture', onStickUp);
    lookEl.addEventListener('pointerdown', onLookDown);
    lookEl.addEventListener('pointermove', onLookMove);
    lookEl.addEventListener('pointerup', onLookUp);
    lookEl.addEventListener('pointercancel', onLookUp);
    lookEl.addEventListener('lostpointercapture', onLookUp);
    bindTouchButton(jumpBtn, (down) => {
      held.jump = down;
    });
    fireBtn.addEventListener('pointerdown', onFireDown);
    fireBtn.addEventListener('pointermove', onFireMove);
    fireBtn.addEventListener('pointerup', onFireUp);
    fireBtn.addEventListener('pointercancel', onFireUp);
    fireBtn.addEventListener('lostpointercapture', onFireUp);
    bindTouchButton(scoreBtn, () => {}, { holdScoreboard: true });
  }

  el.addEventListener('click', onClick);
  el.addEventListener('pointerdown', onPointerDown);
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
      return buildInputSample(held, view);
    },
    setSensitivity(s: number): void {
      sens = normalizeSensitivity(s);
    },
    getYaw(): number {
      return view.yaw;
    },
    getPitch(): number {
      return view.pitch;
    },
    isZooming(): boolean {
      return held.zoom;
    },
    isTouchMode(): boolean {
      return touchMode;
    },
    addYaw(delta: number): void {
      view = addYawAngle(view, delta);
    },
    setView(newYaw: number, newPitch: number): void {
      view = setViewAngles(newYaw, newPitch);
    },
    isLocked(): boolean {
      return locked;
    },
    requestLock,
    dispose(): void {
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerup', onTouchPointerEnd);
      document.removeEventListener('pointercancel', onTouchPointerEnd);
      touchControls?.remove();
    },
  };
}
