import { type Vec3, vec3, clone } from './math';
import type { Brush, AABB } from './mapdef';

// ---------------------------------------------------------------------------
// Swept-AABB collision against the brush soup. Brushes are axis-aligned, so a
// box sweep reduces to a ray vs. Minkowski-expanded box (slab test). This is
// the trace primitive pmove and the rail hitscan are built on.
// ---------------------------------------------------------------------------

export interface TraceResult {
  /** 0..1 along the move; 1 = made it all the way. */
  fraction: number;
  endpos: Vec3;
  /** Surface normal of the plane hit, or null if fraction == 1. */
  normal: Vec3 | null;
  /** Started overlapping a solid. */
  startsolid: boolean;
  /** Entirely inside a solid (start and end). */
  allsolid: boolean;
}

/** Q3's SURFACE_CLIP_EPSILON — traces stop this far short of surfaces. */
const CLIP_EPSILON = 0.125;

/**
 * Brushes are shrunk by this before testing so that a box resting in the
 * CLIP_EPSILON gap left by a previous trace never reads as "start solid".
 */
const SOLID_EPSILON = 0.03125;

/**
 * Sweep a box (mins/maxs relative to position) from start to end against all
 * brushes. Pass zero mins/maxs for a point/ray trace.
 */
export function traceBox(
  start: Vec3,
  end: Vec3,
  mins: Vec3,
  maxs: Vec3,
  brushes: readonly Brush[],
): TraceResult {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;

  let bestFrac = 1;
  let hitAxis = -1;
  let hitSign = 0;
  let startsolid = false;
  let allsolid = false;

  // The shrink exists so a BOX resting in the CLIP_EPSILON gap doesn't read
  // as startsolid. A zero-extent (ray) trace has no such gap, and shrinking
  // would open a 2*SOLID_EPSILON sheet at every flush brush seam that rail
  // shots could thread through solid geometry — so rays get exact bounds.
  const isRay =
    maxs.x - mins.x <= 0 && maxs.y - mins.y <= 0 && maxs.z - mins.z <= 0;
  const eps = isRay ? 0 : SOLID_EPSILON;

  for (let i = 0; i < brushes.length; i++) {
    const b = brushes[i]!;
    // Minkowski expansion: sweep a point against the brush grown by the box.
    const eminx = b.min.x - maxs.x + eps;
    const eminy = b.min.y - maxs.y + eps;
    const eminz = b.min.z - maxs.z + eps;
    const emaxx = b.max.x - mins.x - eps;
    const emaxy = b.max.y - mins.y - eps;
    const emaxz = b.max.z - mins.z - eps;

    let tEnter = -Infinity;
    let tExit = Infinity;
    let axis = -1;
    let sign = 0;

    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (start.x <= eminx || start.x >= emaxx) continue;
    } else {
      const inv = 1 / dx;
      let t1 = (eminx - start.x) * inv;
      let t2 = (emaxx - start.x) * inv;
      let s = dx > 0 ? -1 : 1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tEnter) {
        tEnter = t1;
        axis = 0;
        sign = s;
      }
      if (t2 < tExit) tExit = t2;
    }
    // Y slab
    if (Math.abs(dy) < 1e-9) {
      if (start.y <= eminy || start.y >= emaxy) continue;
    } else {
      const inv = 1 / dy;
      let t1 = (eminy - start.y) * inv;
      let t2 = (emaxy - start.y) * inv;
      let s = dy > 0 ? -1 : 1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tEnter) {
        tEnter = t1;
        axis = 1;
        sign = s;
      }
      if (t2 < tExit) tExit = t2;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (start.z <= eminz || start.z >= emaxz) continue;
    } else {
      const inv = 1 / dz;
      let t1 = (eminz - start.z) * inv;
      let t2 = (emaxz - start.z) * inv;
      let s = dz > 0 ? -1 : 1;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tEnter) {
        tEnter = t1;
        axis = 2;
        sign = s;
      }
      if (t2 < tExit) tExit = t2;
    }

    if (tEnter > tExit) continue; // no intersection

    if (tEnter < 0) {
      // Started inside this brush (all stationary axes already overlap).
      if (tExit > 0) {
        startsolid = true;
        if (tExit >= 1) allsolid = true;
        bestFrac = 0;
      }
      continue;
    }

    if (tEnter < bestFrac && tEnter <= 1) {
      bestFrac = tEnter;
      hitAxis = axis;
      hitSign = sign;
    }
  }

  const moveLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let frac = bestFrac;
  let normal: Vec3 | null = null;

  if (startsolid) {
    frac = 0;
  } else if (bestFrac < 1) {
    // Pull back so we never end flush with (or inside) the surface.
    if (moveLen > 0) frac = Math.max(0, bestFrac - CLIP_EPSILON / moveLen);
    normal = vec3();
    if (hitAxis === 0) normal.x = hitSign;
    else if (hitAxis === 1) normal.y = hitSign;
    else normal.z = hitSign;
  }

  return {
    fraction: frac,
    endpos: vec3(start.x + dx * frac, start.y + dy * frac, start.z + dz * frac),
    normal,
    startsolid,
    allsolid,
  };
}

/**
 * Ray vs. a single AABB (used for rail shots against player hitboxes).
 * Returns the hit parameter t in [0, maxT], or null.
 */
export function rayVsAABB(origin: Vec3, dir: Vec3, box: AABB, maxT: number): number | null {
  let tEnter = 0;
  let tExit = maxT;

  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const mn = [box.min.x, box.min.y, box.min.z];
  const mx = [box.max.x, box.max.y, box.max.z];

  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]!) < 1e-9) {
      if (o[a]! < mn[a]! || o[a]! > mx[a]!) return null;
    } else {
      const inv = 1 / d[a]!;
      let t1 = (mn[a]! - o[a]!) * inv;
      let t2 = (mx[a]! - o[a]!) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
      if (tEnter > tExit) return null;
    }
  }
  return tEnter;
}

/** Convenience: where does a ray stop against the world? */
export function traceRay(
  origin: Vec3,
  dir: Vec3,
  maxDist: number,
  brushes: readonly Brush[],
): { endpos: Vec3; fraction: number } {
  const zero = vec3(0, 0, 0);
  const end = vec3(origin.x + dir.x * maxDist, origin.y + dir.y * maxDist, origin.z + dir.z * maxDist);
  const tr = traceBox(origin, end, zero, zero, brushes);
  return { endpos: clone(tr.endpos), fraction: tr.fraction };
}
