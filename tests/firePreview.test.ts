// Client fire preview helper tests - run with: npx tsx tests/firePreview.test.ts

import { vec3 } from '../shared/math';
import type { Brush } from '../shared/mapdef';
import { computeFirePreview, type FirePreviewMap, type FirePreviewTarget } from '../client/src/firePreview';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function wall(z1: number, z2: number): Brush {
  return { min: vec3(-20, 0, z1), max: vec3(20, 100, z2), mat: 'wall' };
}

function map(brushes: Brush[] = []): FirePreviewMap {
  return { brushes };
}

function target(z: number, alive = true): FirePreviewTarget {
  return { pos: vec3(0, 0, z), alive };
}

console.log('client fire preview');

{
  const preview = computeFirePreview({
    shooterPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    map: map(),
    targets: [],
    range: 100,
  });
  check('empty shot starts at eye height', preview.eye.x === 0 && preview.eye.y === 48 && preview.eye.z === 0);
  check('empty shot reaches max range', preview.end.z === -100 && preview.hitWorld === false && preview.hitTarget === null);
}

{
  const preview = computeFirePreview({
    shooterPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    map: map([wall(-60, -50)]),
    targets: [],
    range: 200,
  });
  check('world hit is marked as impact', preview.hitWorld && preview.hitTarget === null);
  check('world hit stops near front face', preview.end.z < -49 && preview.end.z > -51, `z=${preview.end.z.toFixed(3)}`);
}

{
  const closer = target(-40);
  const farther = target(-90);
  const preview = computeFirePreview({
    shooterPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    map: map([wall(-140, -130)]),
    targets: [farther, closer],
    range: 200,
  });
  check('live target before wall wins over world hit', preview.hitTarget === closer && preview.hitWorld === false);
  check('target hit endpoint is on target hull', preview.end.z < -23 && preview.end.z > -25, `z=${preview.end.z.toFixed(3)}`);
}

{
  const dead = target(-40, false);
  const preview = computeFirePreview({
    shooterPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    map: map([wall(-80, -70)]),
    targets: [dead],
    range: 200,
  });
  check('dead targets are ignored', preview.hitTarget === null && preview.hitWorld);
}

{
  const hidden = target(-90);
  const preview = computeFirePreview({
    shooterPos: vec3(0, 0, 0),
    yaw: 0,
    pitch: 0,
    map: map([wall(-60, -50)]),
    targets: [hidden],
    range: 200,
  });
  check('targets behind world geometry are ignored', preview.hitTarget === null && preview.hitWorld);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall fire preview tests passed');
if (failures) process.exit(1);
