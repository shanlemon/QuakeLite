// Static world geometry: one merged BufferGeometry + one draw call per
// material. UVs are world-aligned planar projections (1 texture repeat per
// 128 units) so textures never stretch and tile seamlessly across brushes.
// Exception: decal/sign inlays get exactly ONE texture tile fitted across the
// brush so logos and floor markings land whole instead of tiling.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDef, MaterialName, Brush, PrismBrush } from '../../../shared/mapdef';
import type { MaterialSet } from './materials';

const UV_SCALE = 1 / 128;

/** Materials whose texture is fitted once per brush instead of world-tiled. */
const FIT_PER_BRUSH: ReadonlySet<MaterialName> = new Set<MaterialName>([
  'emblemRed',
  'emblemBlue',
  'titleMark',
  'portalCircuit',
  'qlSign',
  'triangleRed',
  'triangleBlue',
]);

/**
 * Rewrite UVs from world position, projected along each face's normal axis.
 * BoxGeometry faces are axis-aligned so the dominant normal axis is exact.
 */
function worldAlignUVs(geo: THREE.BufferGeometry): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = x; // floor/ceiling: project onto XZ
      v = z;
    } else if (ax >= az) {
      u = z; // east/west walls: project onto ZY
      v = y;
    } else {
      u = x; // north/south walls: project onto XY
      v = y;
    }
    uv.setXY(i, u * UV_SCALE, v * UV_SCALE);
  }
  uv.needsUpdate = true;
}

/**
 * Map the brush extents to exactly one 0..1 texture tile, projected along
 * each face's normal axis. Used for emblem decal inlays — the top face shows
 * the whole insignia regardless of brush size.
 */
function fitUVs(geo: THREE.BufferGeometry, b: Brush): void {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const sx = Math.max(b.max.x - b.min.x, 0.01);
  const sy = Math.max(b.max.y - b.min.y, 0.01);
  const sz = Math.max(b.max.z - b.min.z, 0.01);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (ay >= ax && ay >= az) {
      u = (x - b.min.x) / sx;
      v = (z - b.min.z) / sz;
    } else if (ax >= az) {
      u = (z - b.min.z) / sz;
      v = (y - b.min.y) / sy;
    } else {
      u = (x - b.min.x) / sx;
      v = (y - b.min.y) / sy;
    }
    uv.setXY(i, u, v);
  }
  uv.needsUpdate = true;
}

function brushGeometry(b: Brush): THREE.BoxGeometry {
  const sx = Math.max(b.max.x - b.min.x, 0.01);
  const sy = Math.max(b.max.y - b.min.y, 0.01);
  const sz = Math.max(b.max.z - b.min.z, 0.01);
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  geo.translate((b.min.x + b.max.x) * 0.5, (b.min.y + b.max.y) * 0.5, (b.min.z + b.max.z) * 0.5);
  if (FIT_PER_BRUSH.has(b.mat)) fitUVs(geo, b);
  else worldAlignUVs(geo);
  return geo;
}

function prismSignedArea(p: PrismBrush): number {
  let area = 0;
  for (let i = 0; i < p.verts.length; i++) {
    const a = p.verts[i]!;
    const b = p.verts[(i + 1) % p.verts.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return area * 0.5;
}

function pushVertex(
  positions: number[],
  normals: number[],
  uvs: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): void {
  positions.push(x, y, z);
  normals.push(nx, ny, nz);
  uvs.push(0, 0);
}

function prismGeometry(p: PrismBrush): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const verts = prismSignedArea(p) >= 0 ? p.verts : [...p.verts].reverse();

  // Top face. XZ counter-clockwise winds downward in Three coordinates, so
  // reverse each fan triangle to face +Y.
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0]!;
    const b = verts[i]!;
    const c = verts[i + 1]!;
    pushVertex(positions, normals, uvs, a.x, p.maxY, a.z, 0, 1, 0);
    pushVertex(positions, normals, uvs, c.x, p.maxY, c.z, 0, 1, 0);
    pushVertex(positions, normals, uvs, b.x, p.maxY, b.z, 0, 1, 0);
  }

  // Bottom face.
  for (let i = 1; i < verts.length - 1; i++) {
    const a = verts[0]!;
    const b = verts[i]!;
    const c = verts[i + 1]!;
    pushVertex(positions, normals, uvs, a.x, p.minY, a.z, 0, -1, 0);
    pushVertex(positions, normals, uvs, b.x, p.minY, b.z, 0, -1, 0);
    pushVertex(positions, normals, uvs, c.x, p.minY, c.z, 0, -1, 0);
  }

  // Sides.
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i]!;
    const b = verts[(i + 1) % verts.length]!;
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez) || 1;
    const nx = ez / len;
    const nz = -ex / len;

    pushVertex(positions, normals, uvs, a.x, p.maxY, a.z, nx, 0, nz);
    pushVertex(positions, normals, uvs, b.x, p.minY, b.z, nx, 0, nz);
    pushVertex(positions, normals, uvs, a.x, p.minY, a.z, nx, 0, nz);

    pushVertex(positions, normals, uvs, a.x, p.maxY, a.z, nx, 0, nz);
    pushVertex(positions, normals, uvs, b.x, p.maxY, b.z, nx, 0, nz);
    pushVertex(positions, normals, uvs, b.x, p.minY, b.z, nx, 0, nz);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  worldAlignUVs(geo);
  return geo;
}

export function buildWorld(map: MapDef, mats: MaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world';

  const byMat = new Map<MaterialName, THREE.BufferGeometry[]>();
  const addGeo = (mat: MaterialName, geo: THREE.BufferGeometry): void => {
    let list = byMat.get(mat);
    if (!list) {
      list = [];
      byMat.set(mat, list);
    }
    list.push(geo);
  };

  for (const brush of [...map.brushes, ...(map.details ?? [])]) {
    addGeo(brush.mat, brushGeometry(brush));
  }
  for (const prism of [...(map.prisms ?? []), ...(map.detailPrisms ?? [])]) {
    addGeo(prism.mat, prismGeometry(prism));
  }

  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false) as THREE.BufferGeometry | null;
    for (const g of geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mats.byName[mat]);
    mesh.name = `world:${mat}`;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    group.add(mesh);
  }

  return group;
}

export function disposeWorld(group: THREE.Group): void {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) (obj.geometry as THREE.BufferGeometry).dispose();
  });
}
