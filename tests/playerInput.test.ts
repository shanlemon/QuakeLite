// Server player input tests - run with: npx tsx tests/playerInput.test.ts

import { vec3 } from '../shared/math';
import type { Brush, MapDef } from '../shared/mapdef';
import { BUTTON_FIRE, createPmoveState, type UserCmd } from '../shared/movement';
import {
  accrueInputBudget,
  enqueueInputCommand,
  initialMsecBudget,
  MSEC_BUDGET_CAP,
  processInputQueue,
  type CommandPlayer,
} from '../server/src/playerInput';

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

const testMap: MapDef = {
  name: 'test',
  displayName: 'test',
  brushes: [
    box(-1024, -64, -1024, 1024, 0, 1024),
    box(-1088, -64, -1024, -1024, 256, 1024),
    box(1024, -64, -1024, 1088, 256, 1024),
    box(-1024, -64, -1088, 1024, 256, -1024),
    box(-1024, -64, 1024, 1024, 256, 1088),
  ],
  jumpPads: [],
  portals: [],
  spawns: [],
  lights: [],
  ambient: 0.5,
  fogColor: 0,
  fogDensity: 0,
  bounds: { min: vec3(-1088, -64, -1088), max: vec3(1088, 256, 1088) },
};

function cmd(partial: Partial<UserCmd> = {}): UserCmd {
  return {
    seq: 0,
    msec: 16,
    yaw: 0,
    pitch: 0,
    fmove: 0,
    smove: 0,
    buttons: 0,
    interpTime: 0,
    ...partial,
  };
}

function player(partial: Partial<CommandPlayer> = {}): CommandPlayer {
  return {
    state: createPmoveState(vec3(0, 0.25, 0)),
    alive: true,
    yaw: 0,
    pitch: 0,
    inputQueue: [],
    lastAckSeq: 0,
    acked: false,
    msecBudget: 100,
    ...partial,
  };
}

console.log('server player input');

{
  const p = player();
  enqueueInputCommand(p, cmd({ seq: 1 }), 2);
  enqueueInputCommand(p, cmd({ seq: 2 }), 2);
  enqueueInputCommand(p, cmd({ seq: 3 }), 2);
  check('enqueueInputCommand caps queue by dropping oldest', p.inputQueue.map((c) => c.seq).join(',') === '2,3');
}

{
  const p = player({ msecBudget: MSEC_BUDGET_CAP - 5 });
  accrueInputBudget([p], 20);
  check('accrueInputBudget caps budget', p.msecBudget === MSEC_BUDGET_CAP, String(p.msecBudget));
  accrueInputBudget([p], -100);
  check('accrueInputBudget ignores negative elapsed time', p.msecBudget === MSEC_BUDGET_CAP, String(p.msecBudget));
  check('initialMsecBudget gives join headroom', initialMsecBudget() === MSEC_BUDGET_CAP / 2);
}

{
  const p = player({ acked: true, lastAckSeq: 2 });
  p.inputQueue.push(cmd({ seq: 1, yaw: 9 }), cmd({ seq: 3, pitch: Math.PI }));
  processInputQueue(p, {
    map: testMap,
    now: 1000,
    gameState: 'playing',
    players: [p],
    tryFire: () => {
      throw new Error('stale/non-fire command should not fire');
    },
  });
  check('processInputQueue skips stale commands and acks newest', p.lastAckSeq === 3 && p.yaw === 0);
  check('processInputQueue clamps pitch', p.pitch === Math.PI / 2, String(p.pitch));
  check('processInputQueue clears queue', p.inputQueue.length === 0);
}

{
  const p = player({ msecBudget: 4 });
  let fireCount = 0;
  p.inputQueue.push(cmd({ seq: 1, buttons: BUTTON_FIRE, msec: 16 }));
  processInputQueue(p, {
    map: testMap,
    now: 1000,
    gameState: 'playing',
    players: [p],
    tryFire: () => {
      fireCount++;
    },
  });
  check('over-budget command is acked', p.lastAckSeq === 1);
  check('over-budget command does not spend budget or fire', p.msecBudget === 4 && fireCount === 0, `budget=${p.msecBudget} fire=${fireCount}`);
}

{
  const p = player({ alive: false });
  let fireCount = 0;
  p.inputQueue.push(cmd({ seq: 1, buttons: BUTTON_FIRE, msec: 16 }));
  processInputQueue(p, {
    map: testMap,
    now: 1000,
    gameState: 'playing',
    players: [p],
    tryFire: () => {
      fireCount++;
    },
  });
  check('dead player commands consume budget', p.msecBudget === 84, String(p.msecBudget));
  check('dead player commands do not fire', fireCount === 0);
}

{
  const p = player();
  let firedSeq = -1;
  p.inputQueue.push(cmd({ seq: 7, buttons: BUTTON_FIRE, msec: 16 }));
  processInputQueue(p, {
    map: testMap,
    now: 1234,
    gameState: 'playing',
    players: [p],
    tryFire: (_p, c, now) => {
      firedSeq = now === 1234 ? c.seq : -2;
    },
  });
  check('alive playing fire command calls injected fire handler', firedSeq === 7);
  check('processed command spends rounded msec budget', p.msecBudget === 84, String(p.msecBudget));
}

{
  const p = player();
  let fireCount = 0;
  p.inputQueue.push(cmd({ seq: 1, buttons: BUTTON_FIRE, msec: 16 }));
  processInputQueue(p, {
    map: testMap,
    now: 1000,
    gameState: 'intermission',
    players: [p],
    tryFire: () => {
      fireCount++;
    },
  });
  check('intermission commands consume budget but do not fire', p.msecBudget === 84 && fireCount === 0, `budget=${p.msecBudget} fire=${fireCount}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall server player input tests passed');
if (failures) process.exit(1);
