// Wire protocol round-trip checks — run with: npx tsx tests/protocol.test.ts

import { vec3 } from '../shared/math';
import {
  encodeInput,
  decodeInput,
  encodeSnapshot,
  decodeSnapshot,
  MSG_INPUT,
  MSG_SNAPSHOT,
  INPUT_BYTES,
  type Snapshot,
} from '../shared/protocol';
import { BUTTON_CROUCH, BUTTON_FIRE, BUTTON_JUMP, type UserCmd } from '../shared/movement';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('input round trip');
{
  const cmd: UserCmd = {
    seq: 123456789,
    msec: 16,
    yaw: -2.5371,
    pitch: 0.7771,
    fmove: 127,
    smove: -127,
    buttons: BUTTON_JUMP | BUTTON_FIRE | BUTTON_CROUCH,
    interpTime: 4123456,
  };
  const buf = encodeInput(cmd);
  check('size', buf.byteLength === INPUT_BYTES, `${buf.byteLength}B`);
  const dv = new DataView(buf);
  check('type byte', dv.getUint8(0) === MSG_INPUT);
  const out = decodeInput(dv);
  check('seq', out.seq === cmd.seq);
  check('msec', out.msec === cmd.msec);
  check('moves', out.fmove === 127 && out.smove === -127);
  check('buttons', out.buttons === (BUTTON_JUMP | BUTTON_FIRE | BUTTON_CROUCH));
  check('angles', Math.abs(out.yaw - cmd.yaw) < 1e-6 && Math.abs(out.pitch - cmd.pitch) < 1e-6);
  check('interpTime', out.interpTime === cmd.interpTime);
}

console.log('snapshot round trip');
{
  const snap: Snapshot = {
    serverTime: 123456.789,
    ackSeq: 4242,
    players: [
      {
        id: 0,
        alive: true,
        onGround: true,
        crouched: false,
        pos: vec3(-512.25, 64.5, 900.125),
        vel: vec3(320.5, -100.25, 12),
        yaw: 1.25,
        pitch: -0.3,
        teleportCount: 7,
        padTouchId: -1,
      },
      {
        id: 5,
        alive: false,
        onGround: false,
        crouched: true,
        pos: vec3(0, 0, 0),
        vel: vec3(0, 0, 0),
        yaw: 0,
        pitch: 0,
        teleportCount: 255,
        padTouchId: 2,
      },
    ],
  };
  const buf = encodeSnapshot(snap);
  const dv = new DataView(buf);
  check('type byte', dv.getUint8(0) === MSG_SNAPSHOT);
  const out = decodeSnapshot(dv);
  check('serverTime', Math.abs(out.serverTime - snap.serverTime) < 1e-9);
  check('ackSeq', out.ackSeq === 4242);
  check('player count', out.players.length === 2);
  const p0 = out.players[0]!;
  const p1 = out.players[1]!;
  check('p0 flags', p0.alive && p0.onGround && !p0.crouched && p0.id === 0);
  check('p0 pos', Math.abs(p0.pos.x + 512.25) < 1e-3 && Math.abs(p0.pos.z - 900.125) < 1e-3);
  check('p0 pad -1', p0.padTouchId === -1);
  check('p1 flags', !p1.alive && !p1.onGround && p1.crouched && p1.id === 5);
  check('p1 teleportCount', p1.teleportCount === 255);
  check('p1 pad', p1.padTouchId === 2);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall protocol tests passed');
if (failures) process.exit(1);
