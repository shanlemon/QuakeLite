// Movement physics validation — run with: npx tsx tests/movement.test.ts
// Proves the VQ3 feel: ground cap 320, jump arc, bunny hop speed keep,
// strafe-jump acceleration beyond 320, step-up, and collision containment.

import { vec3 } from '../shared/math';
import {
  pmove,
  createPmoveState,
  horizontalSpeed,
  BUTTON_JUMP,
  type UserCmd,
  type PmoveState,
} from '../shared/movement';
import { PHYS } from '../shared/constants';
import type { MapDef, Brush } from '../shared/mapdef';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function box(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): Brush {
  return { min: vec3(x1, y1, z1), max: vec3(x2, y2, z2), mat: 'floor' };
}

// A big sealed test room: floor at y=0, ceiling at 512, walls at ±2048,
// plus an 16u step and a 64u wall for step tests.
const testMap: MapDef = {
  name: 'test',
  displayName: 'test',
  brushes: [
    box(-2048, -64, -2048, 2048, 0, 2048), // floor
    box(-2048, 512, -2048, 2048, 576, 2048), // ceiling
    box(-2112, -64, -2048, -2048, 576, 2048), // -x wall
    box(2048, -64, -2048, 2112, 576, 2048), // +x wall
    box(-2048, -64, -2112, 2048, 576, -2048), // -z wall
    box(-2048, -64, 2048, 2048, 576, 2112), // +z wall
    box(900, 0, -200, 1100, 16, 200), // 16u step
    box(1100, 0, -200, 1300, 80, 200), // 80u wall (not steppable)
  ],
  jumpPads: [],
  portals: [],
  spawns: [],
  lights: [],
  ambient: 0.5,
  fogColor: 0,
  fogDensity: 0,
  bounds: { min: vec3(-2112, -64, -2112), max: vec3(2112, 576, 2112) },
};

let seqCounter = 0;
function cmd(partial: Partial<UserCmd>): UserCmd {
  return {
    seq: seqCounter++,
    msec: 8, // 125 fps frames
    yaw: 0,
    pitch: 0,
    fmove: 0,
    smove: 0,
    buttons: 0,
    interpTime: 0,
    ...partial,
  };
}

function freshState(x = 0, z = 0): PmoveState {
  const s = createPmoveState(vec3(x, 0.25, z));
  return s;
}

function runFor(state: PmoveState, ms: number, make: (t: number) => UserCmd): void {
  for (let t = 0; t < ms; t += 8) pmove(state, make(t), testMap);
}

// ---------------------------------------------------------------------------
console.log('ground movement');
{
  const s = freshState();
  runFor(s, 2000, () => cmd({ fmove: 127 }));
  const sp = horizontalSpeed(s);
  check('runs at max ground speed 320', Math.abs(sp - 320) < 2, `speed=${sp.toFixed(1)}`);

  runFor(s, 1500, () => cmd({}));
  check('friction stops the player', horizontalSpeed(s) < 1, `speed=${horizontalSpeed(s).toFixed(2)}`);
}

// ---------------------------------------------------------------------------
console.log('jump arc');
{
  const s = freshState();
  runFor(s, 240, () => cmd({})); // settle onto the floor first
  const restY = s.pos.y;
  let apex = 0;
  let airMs = 0;
  let jumped = false;
  for (let t = 0; t < 1500; t += 8) {
    pmove(s, cmd({ buttons: t < 24 ? BUTTON_JUMP : 0 }), testMap);
    if (!s.onGround) {
      jumped = true;
      airMs += 8;
      apex = Math.max(apex, s.pos.y - restY);
    } else if (jumped) break;
  }
  // v0=270, g=800 → apex = 270²/1600 ≈ 45.6u, air time ≈ 675 ms
  check('jump apex ~45.6u', Math.abs(apex - 45.6) < 3, `apex=${apex.toFixed(1)}`);
  check('air time ~675ms', Math.abs(airMs - 675) < 40, `air=${airMs}ms`);
}

// ---------------------------------------------------------------------------
console.log('bunny hop (held jump, forward only)');
{
  const s = freshState(-1800, 600);
  const east = -Math.PI / 2; // yawForward(-π/2) = +x
  runFor(s, 1500, () => cmd({ fmove: 127, yaw: east })); // get to 320
  const before = horizontalSpeed(s);
  runFor(s, 3000, () => cmd({ fmove: 127, yaw: east, buttons: BUTTON_JUMP }));
  const after = horizontalSpeed(s);
  check('speed kept while auto-hopping', after > before - 6, `before=${before.toFixed(1)} after=${after.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
console.log('strafe jumping');
{
  // Bot: hold forward+right-strafe, turn yaw smoothly while airborne, jump held.
  // Sweep turn rates; correct VQ3 air-accelerate must push well past 320.
  let best = 0;
  let bestRate = 0;
  for (let r = 0.5; r <= 4.0; r += 0.25) {
    for (const rate of [r, -r]) {
      const s = freshState(-1800, -1800);
      let yaw = (Math.PI * 5) / 4; // yawForward(5π/4) = (+x, +z): across the room diagonal
      runFor(s, 800, () => cmd({ fmove: 127, yaw }));
      for (let t = 0; t < 5200; t += 8) {
        if (!s.onGround) yaw += rate * (8 / 1000); // turn only in the air
        pmove(s, cmd({ fmove: 127, smove: 127, yaw, buttons: BUTTON_JUMP }), testMap);
        if (s.pos.x > 1700 || s.pos.z > 1700 || s.pos.x < -1900 || s.pos.z < -1900) break;
      }
      const sp = horizontalSpeed(s);
      if (sp > best) {
        best = sp;
        bestRate = rate;
      }
    }
  }
  check('strafe jumping exceeds 400 ups', best > 400, `best=${best.toFixed(1)} ups @ turn ${bestRate.toFixed(2)} rad/s`);

  // Control: plain forward bunny hop must NOT gain (vanilla VQ3, no strafe).
  const s = freshState(-1500, 600);
  runFor(s, 1200, () => cmd({ fmove: 127, yaw: -Math.PI / 2 }));
  runFor(s, 2500, () => cmd({ fmove: 127, yaw: -Math.PI / 2, buttons: BUTTON_JUMP }));
  const sp = horizontalSpeed(s);
  check('no free speed without strafing', sp < 340, `speed=${sp.toFixed(1)}`);
}

// ---------------------------------------------------------------------------
console.log('steps and walls');
{
  const s = freshState(700, 0);
  runFor(s, 1500, () => cmd({ yaw: -Math.PI / 2, fmove: 127 })); // run +x
  check('climbs a 16u step', s.pos.y > 15 && s.pos.x > 920, `x=${s.pos.x.toFixed(0)} y=${s.pos.y.toFixed(1)}`);
  check('blocked by the 80u wall', s.pos.x < 1100, `x=${s.pos.x.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
console.log('containment fuzz (random inputs, varying frame times)');
{
  // Deterministic LCG so failures are reproducible.
  let rng = 1234567;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const s = freshState();
  let ok = true;
  let worst = '';
  for (let i = 0; i < 30000; i++) {
    const c = cmd({
      msec: 1 + Math.floor(rand() * 40),
      yaw: rand() * Math.PI * 2,
      pitch: (rand() - 0.5) * 3,
      fmove: Math.floor(rand() * 255) - 127,
      smove: Math.floor(rand() * 255) - 127,
      buttons: rand() < 0.3 ? BUTTON_JUMP : 0,
    });
    pmove(s, c, testMap);
    const p = s.pos;
    if (p.y < -0.5 || p.y > 520 || Math.abs(p.x) > 2049 || Math.abs(p.z) > 2049) {
      ok = false;
      worst = `escaped at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) step ${i}`;
      break;
    }
  }
  check('never falls through or escapes the room', ok, worst || '30000 random steps');
}

// ---------------------------------------------------------------------------
console.log('determinism (same inputs → bit-identical result)');
{
  const run = () => {
    const s = freshState(-500, 300);
    seqCounter = 0;
    let rng = 42;
    const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 2000; i++) {
      pmove(
        s,
        cmd({
          msec: 1 + Math.floor(rand() * 30),
          yaw: rand() * 6.28,
          fmove: rand() > 0.3 ? 127 : -127,
          smove: rand() > 0.5 ? 127 : 0,
          buttons: rand() < 0.4 ? BUTTON_JUMP : 0,
        }),
        testMap,
      );
    }
    return s;
  };
  const a = run();
  const b = run();
  check(
    'replay is exact',
    a.pos.x === b.pos.x && a.pos.y === b.pos.y && a.pos.z === b.pos.z && a.vel.x === b.vel.x,
    `(${a.pos.x}, ${a.pos.y}, ${a.pos.z})`,
  );
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall movement tests passed');
if (failures) process.exit(1);
