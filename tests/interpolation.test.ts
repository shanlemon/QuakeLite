// Client interpolation helper tests - run with: npx tsx tests/interpolation.test.ts

import { vec3 } from '../shared/math';
import type { SnapshotPlayer } from '../shared/protocol';
import {
  appendInterpSample,
  pruneInterpBuffer,
  sampleFromSnapshotPlayer,
  sampleInterpBuffer,
  type InterpSample,
} from '../client/src/interpolation';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function sample(t: number, x: number, teleportCount = 0): InterpSample {
  return {
    t,
    pos: vec3(x, x * 0.5, -x),
    yaw: x * 0.01,
    pitch: x * 0.02,
    alive: x >= 0,
    crouched: x > 10,
    teleportCount,
  };
}

console.log('client interpolation');

{
  const p: SnapshotPlayer = {
    id: 7,
    alive: true,
    onGround: false,
    crouched: true,
    pos: vec3(1, 2, 3),
    vel: vec3(),
    yaw: 0.5,
    pitch: -0.25,
    teleportCount: 4,
    padTouchId: -1,
  };
  const s = sampleFromSnapshotPlayer(p, 123);
  check('snapshot player converts to interpolation sample', s.t === 123 && s.pos === p.pos && s.yaw === 0.5 && s.crouched && s.teleportCount === 4);
}

{
  const buf: InterpSample[] = [];
  check('append accepts first sample', appendInterpSample(buf, sample(100, 1)));
  check('append rejects out-of-order sample', !appendInterpSample(buf, sample(99, 2)) && buf.length === 1);
  check('append accepts newer sample', appendInterpSample(buf, sample(120, 3)) && buf.length === 2);
}

{
  const a = sample(100, 0);
  const b = sample(200, 100);
  const mid = sampleInterpBuffer([a, b], 150);
  check('samples interpolate position', near(mid.pos.x, 50) && near(mid.pos.y, 25) && near(mid.pos.z, -50));
  check('samples interpolate angles', near(mid.yaw, 0.5) && near(mid.pitch, 1));
  check('sample alive state comes from newer sample', mid.alive === b.alive);
  check('sample crouch state comes from newer sample', mid.crouched === b.crouched);
  check('render before oldest holds oldest', sampleInterpBuffer([a, b], 50) === a);
  check('render after newest holds newest', sampleInterpBuffer([a, b], 250) === b);
}

{
  const a = sample(100, 0, 1);
  const teleported = sample(200, 100, 2);
  check('teleport count change snaps to newer sample', sampleInterpBuffer([a, teleported], 150) === teleported);

  const wideGap = sample(500, 100, 1);
  check('large snapshot gap snaps to newer sample', sampleInterpBuffer([a, wideGap], 200) === wideGap);
}

{
  const buf = [sample(0, 0), sample(1000, 10), sample(3000, 20), sample(3100, 30)];
  pruneInterpBuffer(buf, 1500);
  check('prune keeps recent samples while preserving at least two', buf.length === 2 && buf[0]!.t === 3000 && buf[1]!.t === 3100);
}

{
  let threw = false;
  try {
    sampleInterpBuffer([], 0);
  } catch {
    threw = true;
  }
  check('empty interpolation buffers fail loudly', threw);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall interpolation tests passed');
if (failures) process.exit(1);
