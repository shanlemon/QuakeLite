// Static world geometry: one merged BufferGeometry + one draw call per
// material. UVs are world-aligned planar projections (1 texture repeat per
// 128 units) so textures never stretch and tile seamlessly across brushes.
// Exception: decal/sign inlays get exactly ONE texture tile fitted across the
// brush so logos and floor markings land whole instead of tiling.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MapDef, MaterialName, Brush } from '../../../shared/mapdef';
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

export function buildWorld(map: MapDef, mats: MaterialSet): THREE.Group {
  const group = new THREE.Group();
  group.name = 'world';

  const byMat = new Map<MaterialName, THREE.BoxGeometry[]>();
  for (const brush of [...map.brushes, ...(map.details ?? [])]) {
    let list = byMat.get(brush.mat);
    if (!list) {
      list = [];
      byMat.set(brush.mat, list);
    }
    list.push(brushGeometry(brush));
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
