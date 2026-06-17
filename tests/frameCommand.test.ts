// Client frame command helper tests - run with: npx tsx tests/frameCommand.test.ts

import { BUTTON_CROUCH, BUTTON_FIRE, BUTTON_JUMP } from '../shared/movement';
import { buildFrameCommand } from '../client/src/frameCommand';
import type { InputSample } from '../client/src/inputState';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const sample: InputSample = {
  fmove: 127,
  smove: -64,
  buttons: BUTTON_JUMP | BUTTON_CROUCH | BUTTON_FIRE,
  yaw: 1.25,
  pitch: -0.4,
};

console.log('client frame command');

{
  const cmd = buildFrameCommand({
    seq: 7,
    dtMs: 16.4,
    sample,
    predicting: true,
    fireReady: true,
    renderTime: 1234.9,
  });
  check('predicting command preserves sequence and view angles', cmd.seq === 7 && cmd.yaw === sample.yaw && cmd.pitch === sample.pitch);
  check('predicting command preserves movement', cmd.fmove === 127 && cmd.smove === -64);
  check('predicting command allows jump, crouch, and ready fire', cmd.buttons === (BUTTON_JUMP | BUTTON_CROUCH | BUTTON_FIRE), String(cmd.buttons));
  check('command rounds msec and floors interpTime', cmd.msec === 16 && cmd.interpTime === 1234);
}

{
  const cmd = buildFrameCommand({
    seq: 8,
    dtMs: 16,
    sample,
    predicting: true,
    fireReady: false,
    renderTime: 10,
  });
  check('fire is gated by cooldown while movement buttons remain held', cmd.buttons === (BUTTON_JUMP | BUTTON_CROUCH), String(cmd.buttons));
}

{
  const cmd = buildFrameCommand({
    seq: 9,
    dtMs: 16,
    sample,
    predicting: false,
    fireReady: true,
    renderTime: -30,
  });
  check('non-predicting command zeros movement', cmd.fmove === 0 && cmd.smove === 0);
  check('non-predicting command clears all buttons', cmd.buttons === 0);
  check('negative render time clamps to zero', cmd.interpTime === 0);
}

{
  const low = buildFrameCommand({ seq: 1, dtMs: 0, sample, predicting: true, fireReady: true, renderTime: 0 });
  const high = buildFrameCommand({ seq: 1, dtMs: 250, sample, predicting: true, fireReady: true, renderTime: 0 });
  const custom = buildFrameCommand({ seq: 1, dtMs: 250, sample, predicting: true, fireReady: true, renderTime: 0, maxMsec: 50 });
  check('msec clamps to default command bounds', low.msec === 1 && high.msec === 100, `low=${low.msec} high=${high.msec}`);
  check('msec supports custom max for tests/tuning', custom.msec === 50, String(custom.msec));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall frame command tests passed');
if (failures) process.exit(1);
