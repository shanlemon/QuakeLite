import { distanceSq } from '../../shared/math';
import type { Vec3 } from '../../shared/math';
import type { SpawnDef } from '../../shared/mapdef';

export type RandomFn = () => number;

export interface SpawnSelectionPlayer {
  alive: boolean;
  state: { pos: Vec3 };
}

function randomIndex(length: number, random: RandomFn): number {
  return Math.max(0, Math.min(length - 1, Math.floor(random() * length)));
}

const SAFE_SPAWN_DIST_FRACTION = 0.8;
const SAFE_SPAWN_CANDIDATE_CAP = 4;

/**
 * Pick a spawn far from living enemies, then randomize among the safest few.
 * This keeps respawns hard to camp without putting players near an obvious
 * enemy just because pure randomness said so.
 */
export function selectSpawn(
  spawns: readonly SpawnDef[],
  forPlayer: SpawnSelectionPlayer,
  players: readonly SpawnSelectionPlayer[],
  random: RandomFn,
): SpawnDef {
  if (spawns.length === 0) throw new Error('map has no spawn points');

  const enemies = players.filter((q) => q !== forPlayer && q.alive);
  if (enemies.length === 0) return spawns[randomIndex(spawns.length, random)]!;

  const scored: { spawn: SpawnDef; nearestEnemyDist: number }[] = [];
  let bestDist = 0;
  for (const spawn of spawns) {
    let nearestEnemyDist = Infinity;
    for (const enemy of enemies) {
      nearestEnemyDist = Math.min(nearestEnemyDist, distanceSq(spawn.pos, enemy.state.pos));
    }
    bestDist = Math.max(bestDist, nearestEnemyDist);
    scored.push({ spawn, nearestEnemyDist });
  }
  scored.sort((a, b) => b.nearestEnemyDist - a.nearestEnemyDist);

  const minSafeDist = bestDist * SAFE_SPAWN_DIST_FRACTION;
  const candidates = scored
    .filter((s) => s.nearestEnemyDist >= minSafeDist)
    .slice(0, SAFE_SPAWN_CANDIDATE_CAP);
  return candidates[randomIndex(candidates.length, random)]!.spawn;
}

export function shuffledIndices(length: number, random: RandomFn): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
