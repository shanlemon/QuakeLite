// Vortex Portal (space floater) validation — run with: npx tsx tests/map.test.ts
// The map is three floating clusters in open void connected only by portals;
// these tests prove that with the real shared physics: spawns are safe, every
// launch pad works, the 8-portal graph routes correctly, the void kills, and
// no cluster is walkable from another.

import { vec3, wrapAngle, yawForward, type Vec3 } from '../shared/math';
import { traceBox } from '../shared/collision';
import { PLAYER_MINS, PLAYER_MAXS } from '../shared/constants';
import { pmove, createPmoveState, type UserCmd } from '../shared/movement';
import { aabbsOverlap, type AABB, type MapDef } from '../shared/mapdef';
import { vortexPortal as m } from '../shared/maps/vortexportal';

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

// Cluster regions (generous envelopes around each floating group).
const RED: AABB = { min: vec3(-820, -80, -1920), max: vec3(720, 560, -1080) };
const BLUE: AABB = { min: vec3(-720, -80, 1080), max: vec3(820, 560, 1920) };
const CENTRAL: AABB = { min: vec3(-340, 290, -440), max: vec3(340, 640, 440) };
const inRegion = (p: Vec3, r: AABB): boolean =>
  p.x > r.min.x && p.x < r.max.x && p.y > r.min.y && p.y < r.max.y && p.z > r.min.z && p.z < r.max.z;
const clusterOf = (p: Vec3): 'red' | 'blue' | 'central' | 'none' =>
  inRegion(p, RED) ? 'red' : inRegion(p, BLUE) ? 'blue' : inRegion(p, CENTRAL) ? 'central' : 'none';

// ---------------------------------------------------------------------------
console.log('map sanity');
{
  let valid = true;
  let inBounds = true;
  for (const b of m.brushes) {
    if (!(b.min.x < b.max.x && b.min.y < b.max.y && b.min.z < b.max.z)) valid = false;
    if (
      b.min.x < m.bounds.min.x ||
      b.max.x > m.bounds.max.x ||
      b.min.y < m.bounds.min.y ||
      b.max.y > m.bounds.max.y ||
      b.min.z < m.bounds.min.z ||
      b.max.z > m.bounds.max.z
    )
      inBounds = false;
  }
  check('every brush has min < max', valid, `${m.brushes.length} brushes`);
  check('brush count <= 450', m.brushes.length <= 450, `${m.brushes.length}`);
  check('all brushes inside bounds', inBounds);
  check('space-floater flags set', m.space === true && m.fogDensity === 0);
  check('anti-grav thrusters present', (m.thrusters?.length ?? 0) >= 4, `${m.thrusters?.length}`);
  check(
    'exactly 8 portals, ids 0..7',
    m.portals.length === 8 && m.portals.every((p, i) => p.id === i),
  );
}

// ---------------------------------------------------------------------------
console.log('180° rotational symmetry');
{
  const key = (v: Vec3): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const MAT_SWAP: Record<string, string> = {
    trimRed: 'trimBlue',
    trimBlue: 'trimRed',
    glowRed: 'glowBlue',
    glowBlue: 'glowRed',
    emblemRed: 'emblemBlue',
    emblemBlue: 'emblemRed',
  };
  const brushKeys = new Set(m.brushes.map((b) => `${key(b.min)}|${key(b.max)}|${b.mat}`));
  const brushSym = m.brushes.every((b) =>
    brushKeys.has(
      `${key(vec3(-b.max.x, b.min.y, -b.max.z))}|${key(vec3(-b.min.x, b.max.y, -b.min.z))}|${MAT_SWAP[b.mat] ?? b.mat}`,
    ),
  );
  check('brushes mirror exactly', brushSym);

  const spawnKeys = new Set(m.spawns.map((s) => `${key(s.pos)}|${wrapAngle(s.yaw).toFixed(4)}`));
  const spawnSym = m.spawns.every((s) =>
    spawnKeys.has(
      `${key(vec3(-s.pos.x, s.pos.y, -s.pos.z))}|${wrapAngle(s.yaw + Math.PI).toFixed(4)}`,
    ),
  );
  check('spawns mirror exactly', spawnSym);

  const padKeys = new Set(m.jumpPads.map((p) => `${key(p.trigger.min)}|${key(p.velocity)}`));
  const padSym = m.jumpPads.every((p) =>
    padKeys.has(
      `${key(vec3(-p.trigger.max.x, p.trigger.min.y, -p.trigger.max.z))}|${key(vec3(-p.velocity.x, p.velocity.y, -p.velocity.z))}`,
    ),
  );
  check('jump pads mirror exactly', padSym);

  let portalSym = true;
  for (let i = 0; i < 4; i++) {
    const a = m.portals[i]!;
    const b = m.portals[i + 4]!;
    if (
      key(b.center) !== key(vec3(-a.center.x, a.center.y, -a.center.z)) ||
      key(b.exitPos) !== key(vec3(-a.exitPos.x, a.exitPos.y, -a.exitPos.z)) ||
      Math.abs(wrapAngle(b.faceYaw - a.faceYaw - Math.PI)) > 1e-6 ||
      Math.abs(wrapAngle(b.exitYaw - a.exitYaw - Math.PI)) > 1e-6 ||
      b.accent === a.accent
    )
      portalSym = false;
  }
  check('portals 4..7 mirror portals 0..3', portalSym);

  const thrKeys = new Set((m.thrusters ?? []).map(key));
  check(
    'thrusters mirror exactly',
    (m.thrusters ?? []).every((t) => thrKeys.has(key(vec3(-t.x, t.y, -t.z)))),
  );
}

// ---------------------------------------------------------------------------
console.log(`spawns (${m.spawns.length})`);
{
  check('at least 10 spawns', m.spawns.length >= 10, `${m.spawns.length}`);
  for (let i = 0; i < m.spawns.length; i++) {
    const s = m.spawns[i]!;
    const solid = traceBox(s.pos, s.pos, PLAYER_MINS, PLAYER_MAXS, m.brushes).startsolid;
    const down = traceBox(
      s.pos,
      vec3(s.pos.x, s.pos.y - 48, s.pos.z),
      PLAYER_MINS,
      PLAYER_MAXS,
      m.brushes,
    );
    check(`spawn ${i} not startsolid`, !solid);
    check(`spawn ${i} grounds within 33u`, down.fraction < 1 && down.fraction * 48 < 33, `drop=${(down.fraction * 48).toFixed(1)}`);
    let minDist = Infinity;
    for (const p of m.portals) {
      const c = vec3(
        (p.trigger.min.x + p.trigger.max.x) / 2,
        (p.trigger.min.y + p.trigger.max.y) / 2,
        (p.trigger.min.z + p.trigger.max.z) / 2,
      );
      const d = Math.hypot(c.x - s.pos.x, c.y - s.pos.y, c.z - s.pos.z);
      if (d < minDist) minDist = d;
    }
    check(`spawn ${i} >=128 from portal triggers`, minDist >= 128, `d=${minDist.toFixed(0)}`);
  }
}

// ---------------------------------------------------------------------------
console.log(`launch pads (${m.jumpPads.length})`);
{
  const feeders: number[] = [];
  for (let i = 0; i < m.jumpPads.length; i++) {
    const pad = m.jumpPads[i]!;
    const st = createPmoveState(vec3(pad.padTop.x, pad.padTop.y + 0.25, pad.padTop.z));
    let settled = 0;
    for (let t = 0; t < 5000; t += 8) {
      pmove(st, cmd(), m);
      if (st.pos.y < m.bounds.min.y) break;
      settled = st.onGround && t > 400 ? settled + 1 : 0;
      if (settled > 12) break;
    }
    const where = clusterOf(st.pos);
    check(
      `pad ${i} flight ends safely grounded on a deck`,
      st.onGround && where !== 'none',
      `→ (${st.pos.x.toFixed(0)}, ${st.pos.y.toFixed(0)}, ${st.pos.z.toFixed(0)}) ${where}${st.teleportCount ? ' via portal' : ''}`,
    );
    if (st.teleportCount > 0) {
      feeders.push(i);
      check(`pad ${i} teleports exactly once`, st.teleportCount === 1, `count=${st.teleportCount}`);
    }
  }
  check(
    'exactly 6 portal-feeding pads (mid pad + 2 flank ferries per side)',
    feeders.length === 6,
    feeders.join(','),
  );
}

// ---------------------------------------------------------------------------
console.log('portal graph (8 portals)');
{
  const expectations: Record<number, 'red' | 'blue' | 'central'> = {
    0: 'blue',
    1: 'blue',
    3: 'red',
    4: 'red',
    5: 'red',
    7: 'blue',
  };
  for (const p of m.portals) {
    const exitMin = vec3(
      p.exitPos.x + PLAYER_MINS.x,
      p.exitPos.y + PLAYER_MINS.y,
      p.exitPos.z + PLAYER_MINS.z,
    );
    const exitMax = vec3(
      p.exitPos.x + PLAYER_MAXS.x,
      p.exitPos.y + PLAYER_MAXS.y,
      p.exitPos.z + PLAYER_MAXS.z,
    );
    const overlapsTrigger = m.portals.some((q) => aabbsOverlap(exitMin, exitMax, q.trigger));
    check(`portal ${p.id} exit clear of all triggers`, !overlapsTrigger);

    if (p.id === 2 || p.id === 6) continue; // floating mid portals → feeder-pad checks below
    const n = yawForward(p.faceYaw);
    const start = vec3(p.center.x + n.x * 120, 0, p.center.z + n.z * 120);
    const down = traceBox(
      vec3(start.x, p.center.y, start.z),
      vec3(start.x, p.center.y - 200, start.z),
      PLAYER_MINS,
      PLAYER_MAXS,
      m.brushes,
    );
    check(`portal ${p.id} has a walkable approach`, down.fraction < 1);
    start.y = down.endpos.y;
    const st = createPmoveState(start);
    const runYaw = wrapAngle(p.faceYaw + Math.PI);
    let settled = 0;
    for (let t = 0; t < 4000; t += 8) {
      pmove(st, cmd({ fmove: st.teleportCount === 0 ? 127 : 0, yaw: runYaw }), m);
      if (st.pos.y < m.bounds.min.y) break;
      settled = st.teleportCount > 0 && st.onGround ? settled + 1 : 0;
      if (settled > 12) break;
    }
    check(`portal ${p.id} teleports an incoming runner`, st.teleportCount === 1, `count=${st.teleportCount}`);
    const where = clusterOf(st.pos);
    check(
      `portal ${p.id} delivers to the ${expectations[p.id]} cluster`,
      where === expectations[p.id] && st.onGround,
      `landed (${st.pos.x.toFixed(0)}, ${st.pos.y.toFixed(0)}, ${st.pos.z.toFixed(0)}) ${where}`,
    );
  }
  for (const [padIdx, portalId] of [
    [0, 2],
    [8, 6],
  ] as const) {
    const pad = m.jumpPads[padIdx]!;
    const st = createPmoveState(vec3(pad.padTop.x, pad.padTop.y + 0.25, pad.padTop.z));
    let settled = 0;
    for (let t = 0; t < 5000; t += 8) {
      pmove(st, cmd(), m);
      settled = st.teleportCount > 0 && st.onGround ? settled + 1 : 0;
      if (settled > 12) break;
    }
    check(
      `mid portal ${portalId} (via its pad) delivers to central`,
      st.teleportCount === 1 && clusterOf(st.pos) === 'central',
      `landed (${st.pos.x.toFixed(0)}, ${st.pos.y.toFixed(0)}, ${st.pos.z.toFixed(0)})`,
    );
  }
}

// ---------------------------------------------------------------------------
console.log('the void is real');
{
  const st = createPmoveState(vec3(-260, 160.25, -1648));
  let died = false;
  for (let t = 0; t < 6000; t += 8) {
    pmove(st, cmd({ fmove: 127, yaw: 0 }), m); // yaw 0 → -z, off the back edge
    if (st.pos.y < m.bounds.min.y) {
      died = true;
      break;
    }
  }
  check('walking off a deck edge falls below the kill plane', died, `y=${st.pos.y.toFixed(0)}`);
}

// ---------------------------------------------------------------------------
console.log('cluster isolation (portals stripped — no walkable route between clusters)');
{
  const noPortals: MapDef = { ...m, portals: [] };
  let rng = 987654321;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < m.spawns.length; i++) {
    const s = m.spawns[i]!;
    const home = clusterOf(s.pos);
    const forbidden =
      home === 'central' ? ['red', 'blue'] : home === 'red' ? ['blue', 'central'] : ['red', 'central'];
    const st = createPmoveState(s.pos);
    let breach = '';
    for (let step = 0; step < 4000; step++) {
      pmove(
        st,
        cmd({
          msec: 1 + Math.floor(rand() * 30),
          yaw: rand() * Math.PI * 2,
          fmove: rand() > 0.25 ? 127 : -127,
          smove: rand() > 0.5 ? 127 : 0,
          buttons: rand() < 0.35 ? 1 : 0,
        }),
        noPortals,
      );
      if (st.pos.y < m.bounds.min.y) {
        st.pos.x = s.pos.x;
        st.pos.y = s.pos.y;
        st.pos.z = s.pos.z;
        st.vel.x = st.vel.y = st.vel.z = 0;
        continue;
      }
      const where = clusterOf(st.pos);
      if (forbidden.includes(where)) {
        breach = `reached ${where} at (${st.pos.x.toFixed(0)}, ${st.pos.y.toFixed(0)}, ${st.pos.z.toFixed(0)})`;
        break;
      }
    }
    check(`spawn ${i} (${home}) cannot walk to another cluster`, breach === '', breach || '4000 steps');
  }
}

// ---------------------------------------------------------------------------
console.log('fuzz sanity (portals active)');
{
  let rng = 24681357;
  const rand = () => ((rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < m.spawns.length; i++) {
    const s = m.spawns[i]!;
    const st = createPmoveState(s.pos);
    let ok = true;
    let why = '';
    for (let step = 0; step < 6000; step++) {
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
      // Leaving bounds on ANY axis is a server-side void death — reset, like
      // the game respawns you. Only ballistic free-fall may do this; getting
      // out while ON GROUND would mean walkable geometry leaks past bounds.
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
          why = `escaped ON FOOT at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`;
          break;
        }
        st.pos.x = s.pos.x;
        st.pos.y = s.pos.y;
        st.pos.z = s.pos.z;
        st.vel.x = st.vel.y = st.vel.z = 0;
        st.teleportCount = 0;
        continue;
      }
    }
    check(`spawn ${i} fuzz stays sane`, ok, why || '6000 random steps');
  }
}

// ---------------------------------------------------------------------------
console.log('misc');
{
  check('light count <= 24', m.lights.length <= 24, `${m.lights.length}`);
  check('ambient suits the pale-deck space look', m.ambient >= 0.4 && m.ambient <= 0.65, `${m.ambient}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall map tests passed');
if (failures) process.exit(1);
