import { rayVsAABB, traceRay } from '../../shared/collision';
import { GAME, PLAYER_MINS, playerEyeHeight, playerMaxs } from '../../shared/constants';
import { ma, vec3, viewDir, type Vec3 } from '../../shared/math';
import type { Brush, MapDef, PrismBrush } from '../../shared/mapdef';

export interface FirePreviewMap {
  brushes: readonly Brush[];
  prisms?: readonly PrismBrush[];
}

export interface FirePreviewTarget {
  pos: Vec3;
  alive: boolean;
  crouched?: boolean;
}

export interface FirePreviewInput {
  shooterPos: Vec3;
  shooterCrouched?: boolean;
  yaw: number;
  pitch: number;
  map: FirePreviewMap;
  targets: Iterable<FirePreviewTarget>;
  range?: number;
}

export interface FirePreview {
  eye: Vec3;
  end: Vec3;
  hitWorld: boolean;
  hitTarget: FirePreviewTarget | null;
}

export function computeFirePreview(input: FirePreviewInput): FirePreview {
  const range = input.range ?? GAME.RAIL_RANGE;
  const eye = vec3(input.shooterPos.x, input.shooterPos.y + playerEyeHeight(input.shooterCrouched === true), input.shooterPos.z);
  const dir = viewDir(input.yaw, input.pitch);
  const world = traceRay(eye, dir, range, input.map.brushes, input.map.prisms);
  let dist = world.fraction * range;
  let hitWorld = world.fraction < 1;
  let hitTarget: FirePreviewTarget | null = null;

  for (const target of input.targets) {
    if (!target.alive) continue;
    const maxs = playerMaxs(target.crouched === true);
    const box = {
      min: vec3(target.pos.x + PLAYER_MINS.x, target.pos.y + PLAYER_MINS.y, target.pos.z + PLAYER_MINS.z),
      max: vec3(target.pos.x + maxs.x, target.pos.y + maxs.y, target.pos.z + maxs.z),
    };
    const t = rayVsAABB(eye, dir, box, dist);
    if (t !== null && t < dist) {
      dist = t;
      hitWorld = false;
      hitTarget = target;
    }
  }

  return {
    eye,
    end: hitTarget ? ma(vec3(), eye, dir, dist) : world.endpos,
    hitWorld,
    hitTarget,
  };
}

export function firePreviewMap(map: MapDef): FirePreviewMap {
  return { brushes: map.brushes, prisms: map.prisms };
}
