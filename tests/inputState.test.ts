// Client input state tests - run with: npx tsx tests/inputState.test.ts

import {
  addYawAngle,
  applyLookDelta,
  buildInputSample,
  clearHeldInput,
  createHeldInputState,
  normalizeSensitivity,
  resolveTouchStick,
  setViewAngles,
} from '../client/src/inputState';
import { BUTTON_FIRE, BUTTON_JUMP } from '../shared/movement';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

console.log('client input state');

{
  const held = createHeldInputState();
  const sample = buildInputSample(held, { yaw: 0.25, pitch: -0.5 });
  check('empty state produces neutral movement', sample.fmove === 0 && sample.smove === 0 && sample.buttons === 0);
  check('sample preserves view angles', sample.yaw === 0.25 && sample.pitch === -0.5);
}

{
  const held = createHeldInputState();
  held.fwd = true;
  held.back = true;
  held.left = true;
  held.right = true;
  held.jump = true;
  held.fire = true;
  const sample = buildInputSample(held, { yaw: 0, pitch: 0 });
  check('opposed movement directions cancel', sample.fmove === 0 && sample.smove === 0);
  check('jump and fire are encoded as button bits', sample.buttons === (BUTTON_JUMP | BUTTON_FIRE), String(sample.buttons));
  clearHeldInput(held);
  const cleared = buildInputSample(held, { yaw: 0, pitch: 0 });
  check('clearHeldInput resets movement and buttons', cleared.fmove === 0 && cleared.smove === 0 && cleared.buttons === 0);
}

{
  check('normalizeSensitivity clamps low values', normalizeSensitivity(-5) === 0.05);
  check('normalizeSensitivity clamps high values', normalizeSensitivity(100) === 20);
  check('normalizeSensitivity preserves in-range values', normalizeSensitivity(3.25) === 3.25);
}

{
  const view = applyLookDelta({ yaw: 0, pitch: 0 }, 1, 1, 2, 0.5, 0.25);
  check('applyLookDelta rotates yaw by movement, sensitivity, and factor', near(view.yaw, -1), String(view.yaw));
  check('applyLookDelta clamps pitch to supplied limit', view.pitch === -0.25, String(view.pitch));
}

{
  const added = addYawAngle({ yaw: Math.PI - 0.1, pitch: 0.5 }, 0.2);
  check('addYawAngle wraps across pi', near(added.yaw, -Math.PI + 0.1), String(added.yaw));
  check('addYawAngle preserves pitch', added.pitch === 0.5);
  const set = setViewAngles(Math.PI * 3, -10, 1);
  check('setViewAngles wraps yaw and clamps pitch', near(set.yaw, Math.PI) && set.pitch === -1);
}

{
  const centered = resolveTouchStick(0, 0, 50, 0.16);
  check('centered touch stick is neutral', !centered.fwd && !centered.back && !centered.left && !centered.right);
  const forward = resolveTouchStick(0, -100, 50, 0.16);
  check('touch stick clamps to radius', near(Math.hypot(forward.x, forward.y), 50), String(Math.hypot(forward.x, forward.y)));
  check('touch stick detects forward', forward.fwd && !forward.back && !forward.left && !forward.right);
  const diagonal = resolveTouchStick(100, 100, 50, 0.16);
  check('touch stick detects diagonal movement', diagonal.back && diagonal.right && !diagonal.fwd && !diagonal.left);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall input state tests passed');
if (failures) process.exit(1);
