// Vector math for QuakeLite. Coordinate system is Three.js-native Y-up:
// the horizontal plane is XZ, gravity acts along -Y, yaw rotates around Y.
// Yaw 0 faces -Z (Three.js camera default); pitch > 0 looks up.
// One unit = one Quake unit.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function clone(a: Vec3): Vec3 {
  return { x: a.x, y: a.y, z: a.z };
}

export function add(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  out.z = a.z + b.z;
  return out;
}

export function sub(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  out.z = a.z - b.z;
  return out;
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s;
  out.y = a.y * s;
  out.z = a.z * s;
  return out;
}

/** out = a + dir * s  (Quake's VectorMA) */
export function ma(out: Vec3, a: Vec3, dir: Vec3, s: number): Vec3 {
  out.x = a.x + dir.x * s;
  out.y = a.y + dir.y * s;
  out.z = a.z + dir.z * s;
  return out;
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const x = a.y * b.z - a.z * b.y;
  const y = a.z * b.x - a.x * b.z;
  const z = a.x * b.y - a.y * b.x;
  return set(out, x, y, z);
}

export function lengthSq(a: Vec3): number {
  return a.x * a.x + a.y * a.y + a.z * a.z;
}

export function length(a: Vec3): number {
  return Math.sqrt(lengthSq(a));
}

export function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function distanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/** Normalizes v in place, returns the original length (Quake's VectorNormalize). */
export function normalize(v: Vec3): number {
  const len = length(v);
  if (len > 0) {
    const inv = 1 / len;
    v.x *= inv;
    v.y *= inv;
    v.z *= inv;
  }
  return len;
}

export function lerpVec(out: Vec3, a: Vec3, b: Vec3, t: number): Vec3 {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  out.z = a.z + (b.z - a.z) * t;
  return out;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Rotate v around the +Y axis by `angle` radians (right-handed), in place-safe. */
export function rotateY(out: Vec3, v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = v.x * c + v.z * s;
  const z = -v.x * s + v.z * c;
  out.x = x;
  out.y = v.y;
  out.z = z;
  return out;
}

/** Horizontal forward direction for a yaw angle. Yaw 0 → (0, 0, -1). */
export function yawForward(yaw: number, out: Vec3 = vec3()): Vec3 {
  return set(out, -Math.sin(yaw), 0, -Math.cos(yaw));
}

/** Horizontal right direction for a yaw angle. Yaw 0 → (1, 0, 0). */
export function yawRight(yaw: number, out: Vec3 = vec3()): Vec3 {
  return set(out, Math.cos(yaw), 0, -Math.sin(yaw));
}

/** Full 3D view direction for yaw + pitch (pitch > 0 looks up). */
export function viewDir(yaw: number, pitch: number, out: Vec3 = vec3()): Vec3 {
  const cp = Math.cos(pitch);
  return set(out, -Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** Yaw angle of a horizontal direction vector (inverse of yawForward). */
export function yawOfDir(dir: Vec3): number {
  return Math.atan2(-dir.x, -dir.z);
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = a % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Shortest-path interpolation between two angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
