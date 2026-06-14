import type { Vec3 } from './math';

// ---------------------------------------------------------------------------
// Map data format. Maps are built from axis-aligned solid boxes ("brushes")
// plus trigger volumes for jump pads and portals. Both the collision code
// (shared) and the renderer (client) consume this same definition.
// ---------------------------------------------------------------------------

/** Material names the client renderer must know how to draw. */
export type MaterialName =
  | 'floor'
  | 'floorAlt'
  | 'stripeDark'
  | 'edgeGlow'
  | 'titleMark'
  | 'wall'
  | 'wallDark'
  | 'ceiling'
  | 'trim'
  | 'trimRed'
  | 'trimBlue'
  | 'metal'
  | 'pillar'
  | 'stairs'
  | 'ledge'
  | 'padBase'
  | 'portalFrame'
  | 'glowRed'
  | 'glowBlue'
  | 'glowWhite'
  | 'portalCircuit'
  | 'qlSign'
  | 'triangleRed'
  | 'triangleBlue'
  /** Painted team emblem deck inlays (big circular insignia). */
  | 'emblemRed'
  | 'emblemBlue';

export interface AABB {
  min: Vec3;
  max: Vec3;
}

/** Solid axis-aligned box. */
export interface Brush extends AABB {
  mat: MaterialName;
}

export interface JumpPadDef {
  /** Trigger volume — touching it sets the player's velocity to `velocity`. */
  trigger: AABB;
  /** Launch velocity (set, not added), e.g. {x:0, y:620, z:120}. */
  velocity: Vec3;
  /** Visual center of the pad surface (for the glow disc + sound). */
  padTop: Vec3;
}

export interface PortalDef {
  id: number;
  /** Trigger volume directly in front of the visible disc. */
  trigger: AABB;
  /** Center of the visible swirling disc. */
  center: Vec3;
  radius: number;
  /** Yaw of the disc's front normal (the direction the portal faces). */
  faceYaw: number;
  /** Where a player teleporting through appears (feet position). */
  exitPos: Vec3;
  /** Travel-direction yaw on exit (= the destination portal's faceYaw). */
  exitYaw: number;
  /** Accent color theme for the visual. */
  accent: 'red' | 'blue';
  /**
   * Visual tilt of the disc back from vertical, in radians (rotation around
   * the disc's local X axis; 0 = upright). Collision/trigger unaffected.
   */
  tilt?: number;
}

export interface SpawnDef {
  pos: Vec3; // feet position
  yaw: number;
}

export interface LightDef {
  pos: Vec3;
  color: number;
  intensity: number;
  range: number;
}

export interface MapDef {
  name: string;
  displayName: string;
  /** Solid collision/render brushes. */
  brushes: Brush[];
  /** Render-only detail brushes: decals, thin lips, signs, nonblocking trim. */
  details?: Brush[];
  jumpPads: JumpPadDef[];
  portals: PortalDef[];
  spawns: SpawnDef[];
  lights: LightDef[];
  /** Hemisphere/ambient base intensity 0..1. */
  ambient: number;
  fogColor: number;
  fogDensity: number;
  /** Overall world bounds (used for sanity checks and the out-of-world kill). */
  bounds: AABB;
  /**
   * Space-floater map: renderer shows a starfield skybox instead of fog and
   * the world is open void — falling below bounds.min.y is a suicide.
   */
  space?: boolean;
  /** Anti-grav thruster emitters under platforms (cone apex positions). */
  thrusters?: Vec3[];
}

export function aabbsOverlap(aMin: Vec3, aMax: Vec3, b: AABB): boolean {
  return (
    aMin.x < b.max.x &&
    aMax.x > b.min.x &&
    aMin.y < b.max.y &&
    aMax.y > b.min.y &&
    aMin.z < b.max.z &&
    aMax.z > b.min.z
  );
}

export function pointInAABB(p: Vec3, b: AABB): boolean {
  return (
    p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z
  );
}

/**
 * The yaw delta applied to velocity and view when traversing a portal:
 * entering travel direction is the portal's back (faceYaw + PI); exiting
 * travel direction is exitYaw.
 */
export function portalYawDelta(p: PortalDef): number {
  return p.exitYaw - (p.faceYaw + Math.PI);
}
