// Spawn selection helper tests - run with: npx tsx tests/spawns.test.ts

import { vec3 } from '../shared/math';
import type { SpawnDef } from '../shared/mapdef';
import { createPmoveState } from '../shared/movement';
import { selectSpawn, shuffledIndices, type SpawnSelectionPlayer } from '../server/src/spawns';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function spawn(x: number, z = 0): SpawnDef {
  return { pos: vec3(x, 0, z), yaw: 0 };
}

function player(x: number, z = 0, alive = true): SpawnSelectionPlayer {
  return { alive, state: createPmoveState(vec3(x, 0, z)) };
}

console.log('spawn helpers');

{
  const spawns = [spawn(0), spawn(100), spawn(200)];
  const self = player(0);
  check('no-enemy spawn uses injected random', selectSpawn(spawns, self, [self], () => 0.75) === spawns[2]);
  check('random index is clamped defensively', selectSpawn(spawns, self, [self], () => 1) === spawns[2]);
}

{
  const spawns = [spawn(-100), spawn(0), spawn(100)];
  const self = player(0);
  const enemies = [player(-90), player(10)];
  check('selects spawn farthest from nearest living enemy', selectSpawn(spawns, self, [self, ...enemies], () => 0) === spawns[2]);
}

{
  const spawns = [spawn(-100), spawn(100)];
  const self = player(100);
  const deadEnemy = player(100, 0, false);
  check('dead players are ignored for spawn choice', selectSpawn(spawns, self, [self, deadEnemy], () => 0) === spawns[0]);
  check('the respawning player is not treated as an enemy', selectSpawn(spawns, self, [self, player(-95)], () => 0) === spawns[1]);
}

{
  const values = [0.1, 0.9, 0.4];
  const order = shuffledIndices(4, () => values.shift() ?? 0);
  check('shuffle uses injected random deterministically', JSON.stringify(order) === '[1,3,2,0]', JSON.stringify(order));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall spawn helper tests passed');
if (failures) process.exit(1);
