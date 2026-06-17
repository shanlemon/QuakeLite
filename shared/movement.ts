// ---------------------------------------------------------------------------
// QuakeLite player movement — a faithful port of Quake 3's VQ3 pmove
// (bg_pmove.c / bg_slidemove.c), translated to Y-up coordinates.
//
// This module is shared verbatim between client (prediction) and server
// (authoritative simulation) so prediction matches the simulation exactly.
// It is deterministic: state' = pmove(state, cmd, map).
//
// Notes vs. the original:
//  - No SnapVector velocity quantization (we keep full floats — smoother and
//    framerate-independent; strafe-jump accel math is unaffected).
//  - PMF_JUMP_HELD is intentionally NOT enforced: holding jump auto-hops.
//  - Friction is skipped on a landing frame where a jump fires, because
//    PM_CheckJump runs before PM_Friction (exactly like Q3) — this is what
//    makes bunny hopping carry speed.
// ---------------------------------------------------------------------------

import {
  type Vec3,
  vec3,
  set,
  copy,
  clone,
  dot,
  cross,
  scale,
  ma,
  length,
  normalize,
  rotateY,
  yawForward,
  yawRight,
  clamp,
} from './math';
import { traceBox, type TraceResult } from './collision';
import { PHYS, PLAYER_MINS, PLAYER_MAXS, playerMaxs } from './constants';
import { type MapDef, type PortalDef, aabbsOverlap, portalYawDelta } from './mapdef';

export const BUTTON_JUMP = 1 << 0;
export const BUTTON_FIRE = 1 << 1;
export const BUTTON_CROUCH = 1 << 2;

/** One client input command (what goes over the wire). */
export interface UserCmd {
  seq: number;
  /** Frame duration in ms (1..250). */
  msec: number;
  yaw: number;
  pitch: number;
  /** -127..127, forward positive. */
  fmove: number;
  /** -127..127, right positive. */
  smove: number;
  buttons: number;
  /** Estimated server time (ms) the client is rendering remotes at — for lag comp. */
  interpTime: number;
}

/** The simulated part of a player. Everything pmove reads/writes lives here. */
export interface PmoveState {
  pos: Vec3; // feet origin
  vel: Vec3;
  onGround: boolean;
  groundNormal: Vec3 | null;
  /** Incremented every portal traversal — lets clients detect teleports. */
  teleportCount: number;
  /** Index of the jump pad currently being touched, -1 if none (edge trigger). */
  padTouchId: number;
  /** True while using the shorter crouched player bounds. */
  crouched: boolean;
}

export function createPmoveState(pos?: Vec3): PmoveState {
  return {
    pos: pos ? clone(pos) : vec3(),
    vel: vec3(),
    onGround: false,
    groundNormal: null,
    teleportCount: 0,
    padTouchId: -1,
    crouched: false,
  };
}

export function copyPmoveState(out: PmoveState, src: PmoveState): PmoveState {
  copy(out.pos, src.pos);
  copy(out.vel, src.vel);
  out.onGround = src.onGround;
  out.groundNormal = src.groundNormal ? clone(src.groundNormal) : null;
  out.teleportCount = src.teleportCount;
  out.padTouchId = src.padTouchId;
  out.crouched = src.crouched;
  return out;
}

export type PmoveEvent =
  | { type: 'jump' }
  | { type: 'land'; impactSpeed: number }
  | { type: 'jumppad'; padIndex: number }
  | { type: 'teleport'; portalId: number; yawDelta: number };

const MAX_CLIP_PLANES = 5;
const GROUND_TRACE_DIST = 0.25;

// Scratch vectors (module-local; pmove is synchronous + single-threaded).
const _fwd = vec3();
const _right = vec3();
const _wishvel = vec3();
const _wishdir = vec3();
const _end = vec3();
const _gnorm = vec3(0, 1, 0);

function tracePlayer(start: Vec3, end: Vec3, map: MapDef, crouched = false): TraceResult {
  return traceBox(start, end, PLAYER_MINS, playerMaxs(crouched), map.brushes, map.prisms);
}

function trace(state: PmoveState, end: Vec3, map: MapDef): TraceResult {
  return tracePlayer(state.pos, end, map, state.crouched);
}

function updateCrouchState(state: PmoveState, cmd: UserCmd, map: MapDef): void {
  if ((cmd.buttons & BUTTON_CROUCH) !== 0) {
    state.crouched = true;
    return;
  }
  if (!state.crouched) return;

  const standTrace = traceBox(state.pos, state.pos, PLAYER_MINS, PLAYER_MAXS, map.brushes, map.prisms);
  if (!standTrace.startsolid && !standTrace.allsolid) state.crouched = false;
}

/** PM_ClipVelocity — slide off a plane, with overbounce. */
export function clipVelocity(vel: Vec3, normal: Vec3, out: Vec3, overbounce: number): Vec3 {
  let backoff = dot(vel, normal);
  if (backoff < 0) backoff *= overbounce;
  else backoff /= overbounce;
  out.x = vel.x - normal.x * backoff;
  out.y = vel.y - normal.y * backoff;
  out.z = vel.z - normal.z * backoff;
  return out;
}

/** PM_CmdScale — diagonal input must not exceed max speed. */
function cmdScale(cmd: UserCmd, speed: number): number {
  const f = Math.abs(cmd.fmove);
  const s = Math.abs(cmd.smove);
  const max = Math.max(f, s);
  if (!max) return 0;
  const total = Math.sqrt(cmd.fmove * cmd.fmove + cmd.smove * cmd.smove);
  return (speed * max) / (127 * total);
}

/** PM_Accelerate — the classic dot-product accelerate (strafe-jump heart). */
function accelerate(state: PmoveState, wishdir: Vec3, wishspeed: number, accel: number, ft: number): void {
  const currentspeed = dot(state.vel, wishdir);
  const addspeed = wishspeed - currentspeed;
  if (addspeed <= 0) return;
  let accelspeed = accel * ft * wishspeed;
  if (accelspeed > addspeed) accelspeed = addspeed;
  ma(state.vel, state.vel, wishdir, accelspeed);
}

/** PM_Friction — ground friction only (no water/spectator modes here). */
function friction(state: PmoveState, ft: number): void {
  const vel = state.vel;
  // When walking, ignore vertical speed for the friction magnitude.
  const vx = vel.x;
  const vz = vel.z;
  const speed = state.onGround ? Math.sqrt(vx * vx + vz * vz) : length(vel);
  if (speed < 1) {
    vel.x = 0;
    vel.z = 0;
    return;
  }
  let drop = 0;
  if (state.onGround) {
    const control = speed < PHYS.STOP_SPEED ? PHYS.STOP_SPEED : speed;
    drop += control * PHYS.FRICTION * ft;
  }
  let newspeed = speed - drop;
  if (newspeed < 0) newspeed = 0;
  newspeed /= speed;
  vel.x *= newspeed;
  vel.y *= newspeed;
  vel.z *= newspeed;
}

/**
 * PM_SlideMove — bump-and-clip against up to 4 planes. Returns true if the
 * move was blocked at any point. With `gravity`, applies the half-step
 * gravity averaging exactly like Q3 (framerate-independent jump arcs).
 */
function slideMove(state: PmoveState, map: MapDef, ft: number, gravity: boolean): boolean {
  const planes: Vec3[] = [];
  const endVelocity = vec3();

  if (gravity) {
    copy(endVelocity, state.vel);
    endVelocity.y -= PHYS.GRAVITY * ft;
    state.vel.y = (state.vel.y + endVelocity.y) * 0.5;
    if (state.groundNormal) {
      // Slide along the ground plane.
      clipVelocity(state.vel, state.groundNormal, state.vel, PHYS.OVERCLIP);
    }
  }

  let timeLeft = ft;

  // Never turn against the ground plane or the original velocity.
  if (state.groundNormal) planes.push(clone(state.groundNormal));
  {
    const v = clone(state.vel);
    normalize(v);
    planes.push(v);
  }

  let bumpcount = 0;
  for (; bumpcount < 4; bumpcount++) {
    // Calculate position we are trying to move to.
    ma(_end, state.pos, state.vel, timeLeft);
    const tr = trace(state, _end, map);

    if (tr.allsolid) {
      // Entity is completely trapped in a solid: don't build up falling speed.
      state.vel.y = 0;
      return true;
    }
    if (tr.fraction > 0) copy(state.pos, tr.endpos);
    if (tr.fraction === 1 || !tr.normal) break; // moved the entire distance

    timeLeft -= timeLeft * tr.fraction;

    if (planes.length >= MAX_CLIP_PLANES) {
      // This shouldn't really happen.
      set(state.vel, 0, 0, 0);
      return true;
    }

    // If it's a plane we hit before, nudge velocity out along it to fix
    // epsilon issues with non-axial planes.
    let repeat = false;
    for (const p of planes) {
      if (dot(tr.normal, p) > 0.99) {
        state.vel.x += tr.normal.x;
        state.vel.y += tr.normal.y;
        state.vel.z += tr.normal.z;
        repeat = true;
        break;
      }
    }
    if (repeat) continue;
    planes.push(clone(tr.normal));

    // Modify velocity so it parallels all of the clip planes.
    for (let i = 0; i < planes.length; i++) {
      const into = dot(state.vel, planes[i]!);
      if (into >= 0.1) continue; // move doesn't interact with the plane

      const clipVel = vec3();
      const endClipVel = vec3();
      clipVelocity(state.vel, planes[i]!, clipVel, PHYS.OVERCLIP);
      clipVelocity(endVelocity, planes[i]!, endClipVel, PHYS.OVERCLIP);

      // See if there is a second plane that the new move enters.
      for (let j = 0; j < planes.length; j++) {
        if (j === i) continue;
        if (dot(clipVel, planes[j]!) >= 0.1) continue;

        clipVelocity(clipVel, planes[j]!, clipVel, PHYS.OVERCLIP);
        if (dot(clipVel, planes[i]!) >= 0) continue;

        // Slide the original velocity along the crease.
        const dir = vec3();
        cross(dir, planes[i]!, planes[j]!);
        normalize(dir);
        scale(clipVel, dir, dot(dir, state.vel));
        scale(endClipVel, dir, dot(dir, endVelocity));

        // If there is a third plane it interacts with, stop dead.
        for (let k = 0; k < planes.length; k++) {
          if (k === i || k === j) continue;
          if (dot(clipVel, planes[k]!) >= 0.1) continue;
          set(state.vel, 0, 0, 0);
          return true;
        }
      }

      copy(state.vel, clipVel);
      copy(endVelocity, endClipVel);
      break;
    }
  }

  if (gravity) copy(state.vel, endVelocity);
  return bumpcount !== 0;
}

/** PM_StepSlideMove — slide, and if blocked, retry from a step up. */
function stepSlideMove(state: PmoveState, map: MapDef, ft: number, gravity: boolean): void {
  const startO = clone(state.pos);
  const startV = clone(state.vel);

  if (!slideMove(state, map, ft, gravity)) return; // got exactly where we wanted to go first try

  // Never step up when you still have up velocity and aren't on the ground.
  const down = clone(startO);
  down.y -= PHYS.STEP_SIZE;
  const trDown = tracePlayer(startO, down, map, state.crouched);
  if (state.vel.y > 0 && (trDown.fraction === 1 || (trDown.normal && trDown.normal.y < 0.7))) {
    return;
  }

  const up = clone(startO);
  up.y += PHYS.STEP_SIZE;

  // Test the player position if they were a stepheight higher.
  const trUp = tracePlayer(startO, up, map, state.crouched);
  if (trUp.allsolid) return; // can't step up

  const stepSize = trUp.endpos.y - startO.y;
  copy(state.pos, trUp.endpos);
  copy(state.vel, startV);

  slideMove(state, map, ft, gravity);

  // Push down the final amount.
  const downEnd = clone(state.pos);
  downEnd.y -= stepSize;
  const trSettle = tracePlayer(state.pos, downEnd, map, state.crouched);
  if (!trSettle.allsolid) copy(state.pos, trSettle.endpos);
  if (trSettle.fraction < 1 && trSettle.normal) {
    clipVelocity(state.vel, trSettle.normal, state.vel, PHYS.OVERCLIP);
  }
}

/** PM_GroundTrace — are we standing on walkable ground? */
function groundTrace(state: PmoveState, map: MapDef): void {
  set(_end, state.pos.x, state.pos.y - GROUND_TRACE_DIST, state.pos.z);
  const tr = trace(state, _end, map);

  if (tr.fraction === 1 || !tr.normal) {
    state.onGround = false;
    state.groundNormal = null;
    return;
  }
  // Check if getting thrown off the ground (jumping away from it).
  if (state.vel.y > 0 && dot(state.vel, tr.normal) > 10) {
    state.onGround = false;
    state.groundNormal = null;
    return;
  }
  // Slopes that are too steep are not walkable.
  if (tr.normal.y < PHYS.MIN_WALK_NORMAL) {
    state.onGround = false;
    state.groundNormal = clone(tr.normal); // still a ground plane for sliding
    return;
  }
  state.onGround = true;
  state.groundNormal = clone(tr.normal);
  // Kill any residual into-ground velocity the slide didn't contact-clip
  // (we may ground via the 0.25u trace while still hovering above the
  // surface). Without this, walkMove's speed-preserving renormalization can
  // reflect a small downward vy into upward hover oscillation. Horizontal
  // speed is untouched, so bunny hopping is unaffected.
  if (dot(state.vel, tr.normal) < 0) {
    clipVelocity(state.vel, tr.normal, state.vel, PHYS.OVERCLIP);
  }
}

/** PM_AirMove. */
function airMove(state: PmoveState, cmd: UserCmd, map: MapDef, ft: number): void {
  const scaleFactor = cmdScale(cmd, PHYS.MAX_SPEED);

  yawForward(cmd.yaw, _fwd);
  yawRight(cmd.yaw, _right);

  set(
    _wishvel,
    _fwd.x * cmd.fmove + _right.x * cmd.smove,
    0,
    _fwd.z * cmd.fmove + _right.z * cmd.smove,
  );
  copy(_wishdir, _wishvel);
  let wishspeed = normalize(_wishdir);
  wishspeed *= scaleFactor;

  // Not on ground, so little effect on velocity — THE strafe-jump line.
  accelerate(state, _wishdir, wishspeed, PHYS.AIR_ACCELERATE, ft);

  // We may have a ground plane that is very steep; slide along it.
  if (state.groundNormal && !state.onGround) {
    clipVelocity(state.vel, state.groundNormal, state.vel, PHYS.OVERCLIP);
  }

  stepSlideMove(state, map, ft, true);
}

/** PM_WalkMove (jump already handled by the caller). */
function walkMove(state: PmoveState, cmd: UserCmd, map: MapDef, ft: number): void {
  friction(state, ft);

  const scaleFactor = cmdScale(cmd, PHYS.MAX_SPEED);

  yawForward(cmd.yaw, _fwd);
  yawRight(cmd.yaw, _right);

  const gn = state.groundNormal ?? _gnorm;
  // Project the forward and right directions onto the ground plane.
  clipVelocity(_fwd, gn, _fwd, PHYS.OVERCLIP);
  clipVelocity(_right, gn, _right, PHYS.OVERCLIP);
  normalize(_fwd);
  normalize(_right);

  set(
    _wishvel,
    _fwd.x * cmd.fmove + _right.x * cmd.smove,
    _fwd.y * cmd.fmove + _right.y * cmd.smove,
    _fwd.z * cmd.fmove + _right.z * cmd.smove,
  );
  copy(_wishdir, _wishvel);
  let wishspeed = normalize(_wishdir);
  wishspeed *= scaleFactor;

  accelerate(state, _wishdir, wishspeed, PHYS.ACCELERATE, ft);

  const vel = length(state.vel);
  // Slide along the ground plane, preserving speed (don't slow on slopes).
  clipVelocity(state.vel, gn, state.vel, PHYS.OVERCLIP);
  const newLen = length(state.vel);
  if (newLen > 0) {
    const rescale = vel / newLen;
    state.vel.x *= rescale;
    state.vel.y *= rescale;
    state.vel.z *= rescale;
  }

  // Don't do anything if standing still.
  if (state.vel.x === 0 && state.vel.z === 0) return;

  stepSlideMove(state, map, ft, false);
}

/** Jump pads + portals. Runs after movement each chunk. */
function touchTriggers(state: PmoveState, map: MapDef, events: PmoveEvent[]): void {
  const maxs = playerMaxs(state.crouched);
  const pmin = vec3(
    state.pos.x + PLAYER_MINS.x,
    state.pos.y + PLAYER_MINS.y,
    state.pos.z + PLAYER_MINS.z,
  );
  const pmax = vec3(
    state.pos.x + maxs.x,
    state.pos.y + maxs.y,
    state.pos.z + maxs.z,
  );

  // Jump pads: touching one sets velocity outright (Q3 trigger_push style).
  let touching = -1;
  for (let i = 0; i < map.jumpPads.length; i++) {
    const pad = map.jumpPads[i]!;
    if (aabbsOverlap(pmin, pmax, pad.trigger)) {
      touching = i;
      copy(state.vel, pad.velocity);
      state.onGround = false;
      state.groundNormal = null;
      if (state.padTouchId !== i) events.push({ type: 'jumppad', padIndex: i });
      break;
    }
  }
  state.padTouchId = touching;

  // Portals: teleport, preserving speed, rotating velocity + view.
  for (const portal of map.portals) {
    if (!aabbsOverlap(pmin, pmax, portal.trigger)) continue;
    teleportThroughPortal(state, portal);
    events.push({ type: 'teleport', portalId: portal.id, yawDelta: portalYawDelta(portal) });
    break;
  }
}

export function teleportThroughPortal(state: PmoveState, portal: PortalDef): void {
  const delta = portalYawDelta(portal);
  copy(state.pos, portal.exitPos);
  rotateY(state.vel, state.vel, delta);
  state.onGround = false;
  state.groundNormal = null;
  state.teleportCount = (state.teleportCount + 1) & 0xff;
}

function pmoveSingle(state: PmoveState, cmd: UserCmd, map: MapDef, msec: number, events: PmoveEvent[]): void {
  const ft = msec / 1000;
  const wasOnGround = state.onGround;
  const fallSpeed = -state.vel.y;

  updateCrouchState(state, cmd, map);
  groundTrace(state, map);

  // Landing detection (for sounds/screen feedback only — no physics effect).
  if (!wasOnGround && state.onGround && fallSpeed > 100) {
    events.push({ type: 'land', impactSpeed: fallSpeed });
  }

  if (state.onGround) {
    if (cmd.buttons & BUTTON_JUMP) {
      // PM_CheckJump fires BEFORE friction → landing-frame jumps keep speed
      // (bunny hop). Held jump auto-hops by design.
      state.vel.y = PHYS.JUMP_VELOCITY;
      state.onGround = false;
      state.groundNormal = null;
      events.push({ type: 'jump' });
      airMove(state, cmd, map, ft);
    } else {
      walkMove(state, cmd, map, ft);
    }
  } else {
    airMove(state, cmd, map, ft);
  }

  groundTrace(state, map);
  touchTriggers(state, map, events);
}

/**
 * Run one user command through the movement simulation. Splits long frames
 * into <= MAX_PMOVE_MSEC chunks exactly like Q3's Pmove(), so results are
 * identical regardless of how the caller batches time.
 */
export function pmove(state: PmoveState, cmd: UserCmd, map: MapDef): PmoveEvent[] {
  const events: PmoveEvent[] = [];
  let msec = clamp(Math.round(cmd.msec), 1, 250);
  while (msec > 0) {
    const chunk = Math.min(msec, PHYS.MAX_PMOVE_MSEC);
    pmoveSingle(state, cmd, map, chunk, events);
    msec -= chunk;
  }
  return events;
}

/** Horizontal speed in ups — what the HUD speedometer shows. */
export function horizontalSpeed(state: PmoveState): number {
  return Math.sqrt(state.vel.x * state.vel.x + state.vel.z * state.vel.z);
}
