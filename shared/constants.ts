import { vec3, type Vec3 } from './math';

// ---------------------------------------------------------------------------
// Quake 3 / Quake Live VQ3 movement constants. Values are the canonical id
// Software defaults from bg_pmove.c — do not "tune" these, strafe jumping
// depends on them exactly.
// ---------------------------------------------------------------------------
export const PHYS = {
  GRAVITY: 800, // ups^2
  JUMP_VELOCITY: 270, // ups
  MAX_SPEED: 320, // g_speed: max ground wish speed, ups
  STOP_SPEED: 100, // pm_stopspeed
  FRICTION: 6, // pm_friction
  ACCELERATE: 10, // pm_accelerate (ground)
  AIR_ACCELERATE: 1.0, // pm_airaccelerate — this is what makes strafe jumping work
  STEP_SIZE: 18, // stair step-up height
  MIN_WALK_NORMAL: 0.7, // steeper than this is not walkable ground
  OVERCLIP: 1.001,
  /** Max milliseconds simulated per pmove chunk (Q3 splits long frames). */
  MAX_PMOVE_MSEC: 66,
} as const;

/** Player AABB: 32×32×56 units, feet at origin. */
export const PLAYER_MINS: Vec3 = vec3(-16, 0, -16);
export const PLAYER_MAXS: Vec3 = vec3(16, 56, 16);
export const PLAYER_CROUCH_MAXS: Vec3 = vec3(16, 32, 16);
export const EYE_HEIGHT = 48; // above feet
export const CROUCH_EYE_HEIGHT = 28; // above feet

export function playerMaxs(crouched: boolean): Vec3 {
  return crouched ? PLAYER_CROUCH_MAXS : PLAYER_MAXS;
}

export function playerEyeHeight(crouched: boolean): number {
  return crouched ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
}

// ---------------------------------------------------------------------------
// Game rules / netcode
// ---------------------------------------------------------------------------
export const GAME = {
  TICK_RATE: 60, // server simulation Hz
  TICK_MS: 1000 / 60,
  SNAPSHOT_DIVISOR: 3, // send a snapshot every Nth tick → 20 Hz
  FRAG_LIMIT: 20,
  TIME_LIMIT_MS: 10 * 60 * 1000,
  FIRE_COOLDOWN_MS: 1500,
  RESPAWN_DELAY_MS: 2000,
  INTERMISSION_MS: 10_000,
  INTERP_DELAY_MS: 100, // remote-entity interpolation buffer
  MAX_PLAYERS_PER_ROOM: 16,
  BEAM_LIFE_MS: 300,
  LAGCOMP_MAX_REWIND_MS: 1000,
  RAIL_RANGE: 16384, // "infinite" hitscan range in units
} as const;

/** Distinct per-player colors (beam + body tint), indexed by colorIdx. */
export const PLAYER_COLORS: number[] = [
  0xff3b30, // red
  0x2f9bff, // blue
  0x35e05a, // green
  0xffd60a, // yellow
  0xbf5bff, // purple
  0xff8c1a, // orange
  0x21e6c1, // teal
  0xff4fd8, // pink
  0xa4e400, // lime
  0x8a7dff, // lavender
  0xff6e6e, // salmon
  0x3ad7ff, // sky
  0xc9a227, // gold
  0x7bffb0, // mint
  0xd96bff, // magenta
  0xffffff, // white
];

export function playerColor(idx: number): number {
  return PLAYER_COLORS[((idx % PLAYER_COLORS.length) + PLAYER_COLORS.length) % PLAYER_COLORS.length]!;
}
