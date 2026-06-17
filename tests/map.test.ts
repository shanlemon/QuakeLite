// The Longest Yard validation - run with: npx tsx tests/map.test.ts
// Proves the q3dm17-style space arena is playable with shared physics:
// spawns are grounded, jump pads route to the intended platforms, teleporters
// exit to the armor bridge, the void kills, and fuzz movement stays sane.

import { vec3, yawForward, yawOfDir, type Vec3 } from '../shared/math';
import { traceBox } from '../shared/collision';
import { PLAYER_MINS, PLAYER_MAXS } from '../shared/constants';
import { createPmoveState, pmove, type UserCmd } from '../shared/movement';
import { aabbsOverlap, type AABB, type MapDef, type PrismBrush } from '../shared/mapdef';
import { longestYard as m } from '../shared/maps/longestyard';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const cmd = (over: Partial<UserCmd> = {}): UserCmd => ({
  seq: 0,
  msec: 8,
  yaw: 0,
  pitch: 0,
  fmove: 0,
  smove: 0,
  buttons: 0,
  interpTime: 0,
  ...over,
});

const solidPrisms = m.prisms ?? [];

const BASE: AABB = { min: vec3(-1500, -80, -1620), max: vec3(1500, 100, 880) };
const UPPER: AABB = { min: vec3(-1840, 120, -720), max: vec3(1840, 310, 920) };
const MID_FRONT: AABB = { min: vec3(-1660, 70, -1380), max: vec3(1660, 200, -650) };
const MID_BACK: AABB = { min: vec3(-1660, 70, 760), max: vec3(1660, 200, 1440) };
const RAIL: AABB = { min: vec3(-820, 30, -2760), max: vec3(820, 180, -1880) };
const MEGA: AABB = { min: vec3(-360, 300, 540), max: vec3(360, 430, 980) };
const POWER: AABB = { min: vec3(-430, 560, 1200), max: vec3(430, 720, 1700) };

function inRegion(p: Vec3, r: AABB): boolean {
  return p.x > r.min.x && p.x < r.max.x && p.y > r.min.y && p.y < r.max.y && p.z > r.min.z && p.z < r.max.z;
}

function regionOf(p: Vec3): 'base' | 'upper' | 'midFront' | 'midBack' | 'rail' | 'mega' | 'power' | 'none' {
  const ax = Math.abs(p.x);
  if (inRegion(p, POWER)) return 'power';
  if (inRegion(p, MEGA)) return 'mega';
  if (inRegion(p, RAIL)) return 'rail';
  if (inRegion(p, UPPER)) return 'upper';
  if (ax >= 860 && inRegion(p, MID_FRONT)) return 'midFront';
  if (ax >= 860 && inRegion(p, MID_BACK)) return 'midBack';
  if (inRegion(p, BASE)) return 'base';
  return 'none';
}

function prismBounds(p: PrismBrush): AABB {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const v of p.verts) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minZ = Math.min(minZ, v.z);
    maxZ = Math.max(maxZ, v.z);
  }
  return { min: vec3(minX, p.minY, minZ), max: vec3(maxX, p.maxY, maxZ) };
}

function insideBounds(b: AABB, bounds: AABB): boolean {
  return (
    b.min.x >= bounds.min.x &&
    b.max.x <= bounds.max.x &&
    b.min.y >= bounds.min.y &&
    b.max.y <= bounds.max.y &&
    b.min.z >= bounds.min.z &&
    b.max.z <= bounds.max.z
  );
}

function settleFromPad(index: number, cmdOver: Partial<UserCmd> = {}): { pos: Vec3; onGround: boolean; teleportCount: number } {
  const pad = m.jumpPads[index]!;
  const st = createPmoveState(vec3(pad.padTop.x, pad.padTop.y + 0.25, pad.padTop.z));
  let settled = 0;
  for (let t = 0; t < 7000; t += 8) {
    pmove(st, cmd(cmdOver), m);
    if (st.pos.y < m.bounds.min.y) break;
    settled = st.onGround && t > 500 ? settled + 1 : 0;
    if (settled > 14) break;
  }
  return { pos: st.pos, onGround: st.onGround, teleportCount: st.teleportCount };
}

function firstGroundFromPad(index: number, cmdOver: Partial<UserCmd> = {}): { pos: Vec3; onGround: boolean } {
  const pad = m.jumpPads[index]!;
  const st = createPmoveState(vec3(pad.padTop.x, pad.padTop.y + 0.25, pad.padTop.z));
  for (let t = 0; t < 7000; t += 8) {
    pmove(st, cmd(cmdOver), m);
    if (st.pos.y < m.bounds.min.y) break;
    if (st.onGround && t > 500) break;
  }
  return { pos: st.pos, onGround: st.onGround };
}

console.log('map sanity');
{
  check('map is The Longest Yard', m.name === 'longestyard' && m.displayName === 'The Longest Yard');
  check('space-floater flags set', m.space === true && m.fogDensity === 0);
  check('no fewer than 40 spawns', m.spawns.length >= 40, `${m.spawns.length}`);
  check('jump pad network present', m.jumpPads.length >= 10, `${m.jumpPads.length}`);
  check('three teleporters present', m.portals.length === 3, `${m.portals.length}`);

  let validBrushes = true;
  for (const b of m.brushes) {
    if (!(b.min.x < b.max.x && b.min.y < b.max.y && b.min.z < b.max.z)) validBrushes = false;
    if (!insideBounds(b, m.bounds)) validBrushes = false;
  }
  check('brushes valid and inside bounds', validBrushes, `${m.brushes.length} brushes`);

  let validPrisms = true;
  for (const p of solidPrisms) {
    if (p.verts.length < 3 || !(p.minY < p.maxY) || !insideBounds(prismBounds(p), m.bounds)) validPrisms = false;
  }
  check('prisms valid and inside bounds', validPrisms, `${solidPrisms.length} prisms`);
  check('anti-grav thrusters present', (m.thrusters?.length ?? 0) >= 8, `${m.thrusters?.length}`);
}

console.log('spawns');
{
  for (let i = 0; i < m.spawns.length; i++) {
    const s = m.spawns[i]!;
    const solid = traceBox(s.pos, s.pos, PLAYER_MINS, PLAYER_MAXS, m.brushes, solidPrisms).startsolid;
    const down = traceBox(s.pos, vec3(s.pos.x, s.pos.y - 64, s.pos.z), PLAYER_MINS, PLAYER_MAXS, m.brushes, solidPrisms);
    const forward = yawForward(s.yaw);
    const centerLen = Math.hypot(s.pos.x, s.pos.z);
    const centerAlignment = centerLen > 0 ? (forward.x * -s.pos.x + forward.z * -s.pos.z) / centerLen : 1;
    check(`spawn ${i} not startsolid`, !solid);
    check(`spawn ${i} grounds within 33u`, down.fraction < 1 && down.fraction * 64 < 33, `drop=${(down.fraction * 64).toFixed(1)}`);
    check(`spawn ${i} faces map center`, centerAlignment > 0.99, `alignment=${centerAlignment.toFixed(3)}`);
  }
}

console.log('jump pads');
{
  const expectations: Record<
    number,
    'base' | 'upper' | 'midFront' | 'midBack' | 'rail' | 'mega' | 'power'
  > = {
    0: 'mega',
    1: 'upper',
    2: 'upper',
    3: 'upper',
    4: 'rail',
    5: 'power',
    6: 'power',
    7: 'midFront',
    8: 'midFront',
    9: 'midBack',
    10: 'midBack',
    11: 'upper',
    12: 'upper',
    13: 'upper',
    14: 'upper',
    15: 'upper',
    16: 'upper',
    17: 'midFront',
    18: 'midFront',
    19: 'midBack',
    20: 'midBack',
  };
  for (const [idxText, expected] of Object.entries(expectations)) {
    const idx = Number(idxText);
    const result = settleFromPad(idx);
    const where = regionOf(result.pos);
    check(
      `pad ${idx} lands on ${expected}`,
      result.onGround && where === expected,
      `landed (${result.pos.x.toFixed(0)}, ${result.pos.y.toFixed(0)}, ${result.pos.z.toFixed(0)}) ${where}`,
    );
  }

  const rearPowerPad = m.jumpPads[5]!;
  const steeredPower = firstGroundFromPad(5, {
    yaw: yawOfDir(vec3(rearPowerPad.velocity.x, 0, rearPowerPad.velocity.z)) - 0.45,
    fmove: 127,
  });
  check(
    'power chain catches modest rear steering',
    steeredPower.onGround && regionOf(steeredPower.pos) === 'power',
    `landed (${steeredPower.pos.x.toFixed(0)}, ${steeredPower.pos.y.toFixed(0)}, ${steeredPower.pos.z.toFixed(0)}) ${regionOf(steeredPower.pos)}`,
  );
}

console.log('teleporters');
{
  for (const p of m.portals) {
    const exitMin = vec3(p.exitPos.x + PLAYER_MINS.x, p.exitPos.y + PLAYER_MINS.y, p.exitPos.z + PLAYER_MINS.z);
    const exitMax = vec3(p.exitPos.x + PLAYER_MAXS.x, p.exitPos.y + PLAYER_MAXS.y, p.exitPos.z + PLAYER_MAXS.z);
    const overlapsTrigger = m.portals.some((q) => aabbsOverlap(exitMin, exitMax, q.trigger));
    check(`portal ${p.id} exit clear of triggers`, !overlapsTrigger);

    const st = createPmoveState(vec3(p.center.x, p.trigger.min.y + 4, p.center.z));
    pmove(st, cmd(), m);
    check(`portal ${p.id} teleports`, st.teleportCount === 1);
    check(`portal ${p.id} exits to armor bridge`, regionOf(st.pos) === 'upper', `exit=(${st.pos.x},${st.pos.y},${st.pos.z})`);
  }
}

console.log('the void is real');
{
  const st = createPmoveState(vec3(0, 96.25, -2500));
  let died = false;
  for (let t = 0; t < 6000; t += 8) {
    pmove(st, cmd({ fmove: 127, yaw: 0 }), m); // run off the far rail edge
    if (st.pos.y < m.bounds.min.y) {
      died = true;
      break;
    }
  }
  check('walking off the rail platform falls below kill plane', died, `y=${st.pos.y.toFixed(0)}`);
}

console.log('fuzz sanity');
{
  let rng = 24681357;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < m.spawns.length; i++) {
    const s = m.spawns[i]!;
    const st = createPmoveState(s.pos);
    let ok = true;
    let why = '';
    for (let step = 0; step < 5000; step++) {
      pmove(
        st,
        cmd({
          msec: 1 + Math.floor(rand() * 30),
          yaw: rand() * Math.PI * 2,
          pitch: (rand() - 0.5) * 3,
          fmove: Math.floor(rand() * 255) - 127,
          smove: Math.floor(rand() * 255) - 127,
          buttons: rand() < 0.3 ? 1 : 0,
        }),
        m,
      );
      const p = st.pos;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        ok = false;
        why = 'NaN position';
        break;
      }
      const outside =
        p.y < m.bounds.min.y ||
        p.y > m.bounds.max.y ||
        p.x < m.bounds.min.x ||
        p.x > m.bounds.max.x ||
        p.z < m.bounds.min.z ||
        p.z > m.bounds.max.z;
      if (outside) {
        if (st.onGround) {
          ok = false;
          why = `escaped on foot at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`;
          break;
        }
        st.pos.x = s.pos.x;
        st.pos.y = s.pos.y;
        st.pos.z = s.pos.z;
        st.vel.x = st.vel.y = st.vel.z = 0;
        st.teleportCount = 0;
      }
    }
    check(`spawn ${i} fuzz stays sane`, ok, why || '5000 random steps');
  }
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall map tests passed');
if (failures) process.exit(1);
