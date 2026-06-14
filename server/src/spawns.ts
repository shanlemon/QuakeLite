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

/** Spawn point with the greatest distance to the nearest living enemy. */
export function selectSpawn(
  spawns: readonly SpawnDef[],
  forPlayer: SpawnSelectionPlayer,
  players: readonly SpawnSelectionPlayer[],
  random: RandomFn,
): SpawnDef {
  if (spawns.length === 0) throw new Error('map has no spawn points');

  const enemies = players.filter((q) => q !== forPlayer && q.alive);
  if (enemies.length === 0) return spawns[randomIndex(spawns.length, random)]!;

  let best = spawns[0]!;
  let bestDist = -1;
  for (const spawn of spawns) {
    let nearestEnemyDist = Infinity;
    for (const enemy of enemies) {
      nearestEnemyDist = Math.min(nearestEnemyDist, distanceSq(spawn.pos, enemy.state.pos));
    }
    if (nearestEnemyDist > bestDist) {
      bestDist = nearestEnemyDist;
      best = spawn;
    }
  }
  return best;
}

export function shuffledIndices(length: number, random: RandomFn): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}
