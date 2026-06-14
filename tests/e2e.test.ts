// Live end-to-end netcode test — run with: npx tsx tests/e2e.test.ts
//
// Boots the REAL server (server/src/index.ts) as a child process on port 3199,
// connects two raw WebSocket clients, and walks the full multiplayer loop:
// join handshake, snapshot cadence, server-authoritative movement + input
// acks, a lag-compensated rail kill, fire cooldown, respawn, and server
// survival after clients disconnect.
//
// Style matches tests/movement.test.ts: check() + process.exit(1) on failure.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { vec3 } from '../shared/math';
import { traceRay } from '../shared/collision';
import { vortexPortal } from '../shared/maps/vortexportal';
import { BUTTON_FIRE, type UserCmd } from '../shared/movement';
import {
  MSG_SNAPSHOT,
  decodeSnapshot,
  encodeInput,
  type ServerJsonMsg,
  type Snapshot,
} from '../shared/protocol';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199;
const WS_URL = `ws://localhost:${PORT}/ws`;
const INSTANCE = 'e2e-test';
const MAP = vortexPortal;

// ------------------------------- harness -----------------------------------

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

/** A failure the rest of the test cannot meaningfully continue past. */
class HardFail extends Error {}
function must(name: string, cond: boolean, detail = ''): void {
  check(name, cond, detail);
  if (!cond) throw new HardFail(`${name}${detail ? ` (${detail})` : ''}`);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ------------------------------ server child -------------------------------

function probePort(port: number, timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: 'localhost' });
    const done = (open: boolean) => {
      sock.destroy();
      resolve(open);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

let serverExited = false;

function startServer(): ChildProcess {
  const child = spawn('npx tsx server/src/index.ts', {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    shell: true, // required for npx on Windows
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const pipe = (chunk: Buffer) => {
    for (const line of chunk.toString().split(/\r?\n/)) {
      if (line.trim()) console.log(`    [server] ${line}`);
    }
  };
  child.stdout?.on('data', pipe);
  child.stderr?.on('data', pipe);
  child.on('exit', (code) => {
    serverExited = true;
    console.log(`    [server] exited (code ${code})`);
  });
  return child;
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || serverExited) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
  } else {
    child.kill('SIGKILL');
  }
}

async function waitForPort(timeoutMs = 20000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverExited) throw new HardFail('server process exited before accepting connections');
    if (await probePort(PORT)) return;
    await sleep(200);
  }
  throw new HardFail(`server did not accept connections on port ${PORT} within ${timeoutMs}ms`);
}

// -------------------------------- client -----------------------------------

interface Welcome extends Record<string, unknown> {
  type: 'welcome';
  id: number;
  mapName: string;
  players: { id: number; name: string }[];
}

interface Stamped {
  m: ServerJsonMsg;
  t: number;
}

class Client {
  ws: WebSocket;
  readonly label: string;
  id = -1;
  welcome: Welcome | null = null;
  /** Every JSON message received, with receipt time (Date.now()). */
  msgs: Stamped[] = [];
  latestSnap: Snapshot | null = null;
  snapCount = 0;
  seq = 1;
  private msgListeners = new Set<() => void>();
  private snapListeners = new Set<(s: Snapshot) => void>();

  constructor(label: string) {
    this.label = label;
    this.ws = new WebSocket(WS_URL);
    this.ws.binaryType = 'arraybuffer';
    this.ws.on('error', (err) => console.error(`    [client ${label}] ws error: ${err.message}`));
    this.ws.on('message', (data, isBinary) => {
      if (isBinary) {
        const dv =
          data instanceof ArrayBuffer
            ? new DataView(data)
            : Buffer.isBuffer(data)
              ? new DataView(data.buffer, data.byteOffset, data.byteLength)
              : null;
        if (!dv || dv.byteLength < 1 || dv.getUint8(0) !== MSG_SNAPSHOT) return;
        const snap = decodeSnapshot(dv);
        this.latestSnap = snap;
        this.snapCount++;
        for (const l of [...this.snapListeners]) l(snap);
        return;
      }
      const text = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
      const m = JSON.parse(text) as ServerJsonMsg;
      this.msgs.push({ m, t: Date.now() });
      for (const l of [...this.msgListeners]) l();
    });
  }

  onMsg(l: () => void): () => void {
    this.msgListeners.add(l);
    return () => this.msgListeners.delete(l);
  }

  onSnap(l: (s: Snapshot) => void): () => void {
    this.snapListeners.add(l);
    return () => this.snapListeners.delete(l);
  }

  /** My own entry in the latest snapshot. */
  me(): { pos: { x: number; y: number; z: number }; alive: boolean } | null {
    return this.latestSnap?.players.find((p) => p.id === this.id) ?? null;
  }

  sendCmd(partial: Partial<UserCmd>): UserCmd {
    const cmd: UserCmd = {
      seq: this.seq++,
      msec: 16,
      yaw: 0,
      pitch: 0,
      fmove: 0,
      smove: 0,
      buttons: 0,
      interpTime: this.latestSnap ? Math.floor(this.latestSnap.serverTime) : 0,
      ...partial,
    };
    this.ws.send(encodeInput(cmd));
    return cmd;
  }
}

function connectAndJoin(label: string, username: string, timeoutMs = 5000): Promise<Client> {
  return new Promise((resolve, reject) => {
    const c = new Client(label);
    const timer = setTimeout(() => {
      reject(new HardFail(`client ${label}: no welcome within ${timeoutMs}ms`));
    }, timeoutMs);
    c.ws.on('open', () => {
      c.ws.send(
        JSON.stringify({
          type: 'join',
          instanceId: INSTANCE,
          user: { id: `e2e-${label}`, username, avatar: null },
        }),
      );
    });
    c.ws.on('close', (code, reason) => {
      if (!c.welcome) {
        clearTimeout(timer);
        reject(new HardFail(`client ${label}: socket closed before welcome (${code} ${reason.toString()})`));
      }
    });
    const off = c.onMsg(() => {
      const last = c.msgs[c.msgs.length - 1]!.m;
      if (last.type === 'welcome') {
        c.welcome = last as unknown as Welcome;
        c.id = last.id;
        clearTimeout(timer);
        off();
        resolve(c);
      } else if (last.type === 'error') {
        clearTimeout(timer);
        off();
        reject(new HardFail(`client ${label}: server error on join: ${last.code} ${last.message}`));
      }
    });
  });
}

/**
 * Wait for a JSON message matching `pred`, scanning c.msgs from index `from`
 * (so messages that already arrived are not missed) and then listening live.
 */
function waitForMsg<T extends ServerJsonMsg>(
  c: Client,
  desc: string,
  pred: (m: ServerJsonMsg) => boolean,
  opts: { from?: number; timeoutMs?: number } = {},
): Promise<{ m: T; t: number }> {
  const { from = 0, timeoutMs = 5000 } = opts;
  return new Promise((resolve, reject) => {
    let scanned = from;
    const scan = (): boolean => {
      for (; scanned < c.msgs.length; scanned++) {
        const s = c.msgs[scanned]!;
        if (pred(s.m)) {
          resolve({ m: s.m as T, t: s.t });
          return true;
        }
      }
      return false;
    };
    if (scan()) return;
    const timer = setTimeout(() => {
      off();
      reject(new HardFail(`client ${c.label}: timed out (${timeoutMs}ms) waiting for ${desc}`));
    }, timeoutMs);
    const off = c.onMsg(() => {
      if (scan()) {
        clearTimeout(timer);
        off();
      }
    });
  });
}

function waitForSnap(
  c: Client,
  desc: string,
  pred: (s: Snapshot) => boolean,
  timeoutMs = 5000,
): Promise<Snapshot> {
  return new Promise((resolve, reject) => {
    if (c.latestSnap && pred(c.latestSnap)) {
      resolve(c.latestSnap);
      return;
    }
    const timer = setTimeout(() => {
      off();
      reject(new HardFail(`client ${c.label}: timed out (${timeoutMs}ms) waiting for snapshot: ${desc}`));
    }, timeoutMs);
    const off = c.onSnap((s) => {
      if (pred(s)) {
        clearTimeout(timer);
        off();
        resolve(s);
      }
    });
  });
}

// --------------------------- movement helpers ------------------------------

/**
 * Server-authoritative "walk to": every 16ms aim a forward cmd at the target
 * (XZ) based on my own latest snapshot position; stop when within stopDist or
 * stopWhen() fires, then brake to a standstill. pmove slides along walls, so
 * straight-line servoing converges everywhere this test goes.
 */
async function walkTo(
  c: Client,
  tx: number,
  tz: number,
  opts: { stopDist?: number; timeoutMs?: number; stopWhen?: (p: { x: number; y: number; z: number }) => boolean } = {},
): Promise<void> {
  const { stopDist = 32, timeoutMs = 20000, stopWhen } = opts;
  const deadline = Date.now() + timeoutMs;
  // Stuck recovery: if we stop making progress (wedged square-on against a
  // wall, so sliding has no tangential component), steer 90° off for a moment.
  let checkAt = Date.now() + 1500;
  let checkPos = { ...c.me()!.pos };
  let dodgeUntil = 0;
  let dodgeSign = 1;
  for (;;) {
    const me = c.me();
    if (!me) throw new HardFail(`client ${c.label} missing from its own snapshot during walkTo`);
    const p = me.pos;
    if (stopWhen ? stopWhen(p) : Math.hypot(tx - p.x, tz - p.z) <= stopDist) break;
    const now = Date.now();
    if (now > deadline) {
      throw new HardFail(
        `client ${c.label}: walkTo(${tx}, ${tz}) timed out at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`,
      );
    }
    if (now >= checkAt) {
      if (Math.hypot(p.x - checkPos.x, p.z - checkPos.z) < 12) {
        dodgeSign = -dodgeSign;
        dodgeUntil = now + 500;
      }
      checkAt = now + 1500;
      checkPos = { ...p };
    }
    let yaw = Math.atan2(-(tx - p.x), -(tz - p.z)); // yawForward = (-sin, 0, -cos)
    if (now < dodgeUntil) yaw += (dodgeSign * Math.PI) / 2;
    c.sendCmd({ fmove: 127, yaw });
    await sleep(16);
  }
  // Brake: idle cmds so friction runs (the server only simulates on cmds).
  for (let i = 0; i < 30; i++) {
    c.sendCmd({});
    await sleep(16);
  }
  await sleep(250); // let the settled position reach us in a snapshot
}

/**
 * Identify the major Longest Yard deck a player is on. The e2e test can then
 * route any randomized spawn back to the lower base floor before staging a
 * deterministic rail shot.
 */
type Region = 'base' | 'upper' | 'midFront' | 'midBack' | 'rail' | 'power' | 'air';

function regionOf(p: { x: number; y: number; z: number }): Region {
  const ax = Math.abs(p.x);
  if (p.y >= 500 && ax <= 280 && p.z >= 600 && p.z <= 980) return 'power';
  if (p.y >= 30 && p.y <= 180 && ax <= 540 && p.z >= -1660 && p.z <= -1060) return 'rail';
  if (p.y >= 120 && p.y <= 300 && ax <= 1320 && p.z >= -520 && p.z <= 540) return 'upper';
  if (p.y >= 80 && p.y <= 190 && ax >= 680 && ax <= 1230 && p.z >= -1040 && p.z <= -500) return 'midFront';
  if (p.y >= 80 && p.y <= 190 && ax >= 680 && ax <= 1230 && p.z >= 680 && p.z <= 1180) return 'midBack';
  if (p.y >= -80 && p.y <= 100 && ax <= 1120 && p.z >= -560 && p.z <= 560) return 'base';
  return 'air';
}

/**
 * Hands-off flight: keep the server simulating with idle cmds (it only steps
 * a player when cmds arrive) but apply NO steering, so pad arcs and portal
 * drops fly exactly as the map intends. Resolves when pred(pos) holds.
 */
async function coast(
  c: Client,
  label: string,
  pred: (p: { x: number; y: number; z: number }) => boolean,
  timeoutMs = 9000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const p = c.me()!.pos;
    if (pred(p)) return;
    if (Date.now() > deadline) {
      throw new HardFail(
        `${c.label}: coast(${label}) timed out at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)})`,
      );
    }
    c.sendCmd({});
    await sleep(16);
  }
}

async function stageToBaseFloor(c: Client): Promise<void> {
  for (let hop = 0; hop < 12; hop++) {
    const p = c.me()!.pos;
    const r = regionOf(p);
    if (r === 'base') return;
    console.log(`  ..    ${c.label} at (${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}) [${r}] - routing toward base floor`);
    switch (r) {
      case 'upper':
        await walkTo(c, 0, 0, { stopWhen: (q) => regionOf(q) === 'base', timeoutMs: 15000 });
        break;
      case 'midFront':
        await walkTo(c, p.x < 0 ? -920 : 920, -850, { stopWhen: (q) => q.y > 170, timeoutMs: 15000 });
        await coast(c, 'front mid pad to upper', (q) => regionOf(q) === 'upper');
        break;
      case 'midBack':
        await walkTo(c, p.x < 0 ? -920 : 920, 850, { stopWhen: (q) => q.y > 170, timeoutMs: 15000 });
        await coast(c, 'rear mid pad to upper', (q) => regionOf(q) === 'upper');
        break;
      case 'rail':
        await walkTo(c, p.x < 0 ? -170 : 170, -1460, { stopWhen: (q) => q.y > 150, timeoutMs: 15000 });
        await coast(c, 'rail return pad to upper', (q) => regionOf(q) === 'upper');
        break;
      case 'power':
        await walkTo(c, 208, 790, { stopWhen: (q) => regionOf(q) === 'upper', timeoutMs: 15000 });
        break;
      case 'air':
        await coast(c, 'landing', (q) => regionOf(q) !== 'air', 6000);
        break;
    }
    await sleep(350); // settle + let the latest snapshot arrive
  }
  throw new HardFail(`${c.label} could not reach the base floor`);
}

const inBounds = (p: { x: number; y: number; z: number }): boolean =>
  p.x >= MAP.bounds.min.x && p.x <= MAP.bounds.max.x &&
  p.y >= MAP.bounds.min.y && p.y <= MAP.bounds.max.y &&
  p.z >= MAP.bounds.min.z && p.z <= MAP.bounds.max.z;

// --------------------------------- test ------------------------------------

async function main(server: ChildProcess): Promise<void> {
  await waitForPort();
  console.log('server is up');

  // ----- 2. join handshake --------------------------------------------------
  console.log('join handshake');
  const A = await connectAndJoin('A', 'AliceE2E');
  const B = await connectAndJoin('B', 'BobE2E');
  check('both clients got a welcome', A.welcome !== null && B.welcome !== null);
  must('welcome ids are distinct', A.id !== B.id, `A=${A.id} B=${B.id}`);
  check('A welcome mapName is longestyard', A.welcome!.mapName === 'longestyard', A.welcome!.mapName);
  check('B welcome mapName is longestyard', B.welcome!.mapName === 'longestyard', B.welcome!.mapName);
  const bSeesA = B.welcome!.players.find((p) => p.id === A.id);
  check("B's welcome lists client A", bSeesA !== undefined && bSeesA.name === 'AliceE2E',
    JSON.stringify(B.welcome!.players.map((p) => p.name)));
  const join = await waitForMsg(A, 'playerJoin for B', (m) => m.type === 'playerJoin' && m.player.id === B.id);
  check('playerJoin carries B\'s name', join.m.type === 'playerJoin' && join.m.player.name === 'BobE2E');

  // ----- 3. snapshots flow at ~20 Hz with both players ----------------------
  console.log('snapshot flow');
  await waitForMsg(A, "A's own respawn", (m) => m.type === 'respawn' && m.id === A.id);
  await waitForMsg(A, "B's respawn (seen by A)", (m) => m.type === 'respawn' && m.id === B.id);
  await waitForMsg(B, "B's own respawn", (m) => m.type === 'respawn' && m.id === B.id);
  const bothAlive = (s: Snapshot) => {
    const a = s.players.find((p) => p.id === A.id);
    const b = s.players.find((p) => p.id === B.id);
    return s.players.length === 2 && !!a && !!b && a.alive && b.alive;
  };
  await waitForSnap(A, 'both players present and alive', bothAlive);
  await waitForSnap(B, 'both players present and alive', bothAlive);
  check('snapshots contain both players, both alive', true);

  const a0 = A.snapCount;
  const b0 = B.snapCount;
  await sleep(1000);
  const aRate = A.snapCount - a0;
  const bRate = B.snapCount - b0;
  check('A snapshot rate ~20 Hz (15..25 in 1s)', aRate >= 15 && aRate <= 25, `${aRate}/s`);
  check('B snapshot rate ~20 Hz (15..25 in 1s)', bRate >= 15 && bRate <= 25, `${bRate}/s`);

  // ----- 4. movement + input acks -------------------------------------------
  // The decks float in void, so a fixed walk direction could march a spawn
  // straight off an edge. Steer toward the spawn deck's own anchor point
  // instead (servo per cmd) and assert displacement + acks + bounds.
  console.log('movement (60 steered cmds toward the deck anchor)');
  must('A has not sent any inputs yet (seq starts at 1)', A.seq === 1, `seq=${A.seq}`);
  const startPos = { ...A.me()!.pos };
  const ANCHORS: Partial<Record<Region, [number, number]>> = {
    base: [0, 0],
    upper: [Math.sign(startPos.x || 1) * 900, 250],
    midFront: [Math.sign(startPos.x || 1) * 920, -760],
    midBack: [Math.sign(startPos.x || 1) * 920, 940],
    rail: [0, -1380],
    power: [0, 790],
  };
  const anchor = ANCHORS[regionOf(startPos)] ?? [startPos.x, startPos.z];
  let allInBounds = inBounds(startPos);
  const offSampler = A.onSnap((s) => {
    const me = s.players.find((p) => p.id === A.id);
    if (me && !inBounds(me.pos)) allInBounds = false;
  });
  for (let i = 0; i < 60; i++) {
    const p = A.me()!.pos;
    const close = Math.hypot(anchor[0] - p.x, anchor[1] - p.z) <= 48;
    A.sendCmd({
      fmove: close ? 0 : 127,
      yaw: Math.atan2(-(anchor[0] - p.x), -(anchor[1] - p.z)),
    }); // seq 1..60, msec 16
    await sleep(16);
  }
  const acked = await waitForSnap(A, 'ackSeq reaches 60', (s) => s.ackSeq >= 60, 3000);
  check('ackSeq advanced to exactly 60', acked.ackSeq === 60, `ackSeq=${acked.ackSeq}`);
  await sleep(150); // catch the last post-movement snapshot
  offSampler();
  const endPos = A.me()!.pos;
  const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
  const nearAnchor = Math.hypot(anchor[0] - endPos.x, anchor[1] - endPos.z) <= 64;
  check(
    'server moved A per inputs (≥40u or reached the anchor)',
    moved >= 40 || nearAnchor,
    `moved=${moved.toFixed(0)}u from (${startPos.x.toFixed(0)}, ${startPos.z.toFixed(0)})`,
  );
  check('A stayed inside map bounds throughout', allInBounds);

  // ----- staging: bring both players onto the lower base floor ---------------
  // Spawns can scatter across the floating decks; the base floor gives a stable
  // line of sight for the rail shot.
  console.log('staging both players for the rail shot');
  await stageToBaseFloor(A);
  await stageToBaseFloor(B);
  await walkTo(A, -220, 0);
  await walkTo(B, 220, 0);

  // ----- 5. the rail ---------------------------------------------------------
  console.log('rail kill (exact aim from the latest snapshot)');
  const snap = A.latestSnap!;
  const pa = snap.players.find((p) => p.id === A.id)!.pos;
  const pb = snap.players.find((p) => p.id === B.id)!.pos;
  const eye = vec3(pa.x, pa.y + 48, pa.z);
  const target = vec3(pb.x, pb.y + 28, pb.z);
  const d = vec3(target.x - eye.x, target.y - eye.y, target.z - eye.z);
  const len = Math.hypot(d.x, d.y, d.z);
  const yaw = Math.atan2(-d.x, -d.z);
  const pitch = Math.asin(d.y / len);
  // Sanity-check the staging produced line of sight (test setup, not product).
  const los = traceRay(eye, vec3(d.x / len, d.y / len, d.z / len), len, MAP.brushes, MAP.prisms);
  must('staging produced line of sight A → B', los.fraction > 0.99,
    `fraction=${los.fraction.toFixed(3)} A=(${pa.x.toFixed(0)},${pa.z.toFixed(0)}) B=(${pb.x.toFixed(0)},${pb.z.toFixed(0)})`);

  const fromA = A.msgs.length;
  const fromB = B.msgs.length;
  const fireAim = { yaw, pitch };
  A.sendCmd({ buttons: BUTTON_FIRE, yaw, pitch, interpTime: Math.floor(snap.serverTime) });

  const beamA = await waitForMsg(A, 'beam with shooter A', (m) => m.type === 'beam' && m.shooter === A.id, { from: fromA, timeoutMs: 1000 });
  check('beam broadcast received by A', true);
  await waitForMsg(B, 'beam with shooter A (B too)', (m) => m.type === 'beam' && m.shooter === A.id, { from: fromB, timeoutMs: 1000 });
  check('beam broadcast received by B', true);
  check('beam reports the hit on B', beamA.m.type === 'beam' && beamA.m.hit === B.id, JSON.stringify(beamA.m));
  const kill = await waitForMsg(A, 'kill killer=A victim=B', (m) => m.type === 'kill' && m.killer === A.id && m.victim === B.id, { from: fromA, timeoutMs: 1000 });
  check('kill: killer A, victim B', true);
  const scores = await waitForMsg(A, 'scores with A frags=1', (m) => {
    if (m.type !== 'scores') return false;
    const row = m.rows.find((r) => r.id === A.id);
    return !!row && row.frags === 1;
  }, { from: fromA, timeoutMs: 1000 });
  const bRow = scores.m.type === 'scores' ? scores.m.rows.find((r) => r.id === B.id) : undefined;
  check('scores: A frags=1', true);
  check('scores: B deaths=1', !!bRow && bRow.deaths === 1, JSON.stringify(bRow));
  await waitForSnap(A, 'B flagged dead', (s) => s.players.find((p) => p.id === B.id)?.alive === false, 1000);
  check('snapshot shows B alive=false after the kill', true);

  // ----- 6. fire cooldown -----------------------------------------------------
  console.log('fire cooldown (1500 ms)');
  const tFirstBeam = beamA.t;
  const beamsAfterKill = () =>
    A.msgs.slice(fromA).filter((s) => s.m.type === 'beam' && s.m.shooter === A.id).length;
  await sleep(100);
  A.sendCmd({ buttons: BUTTON_FIRE, ...fireAim });
  await sleep(100);
  A.sendCmd({ buttons: BUTTON_FIRE, ...fireAim });
  const remaining = tFirstBeam + 1200 - Date.now();
  if (remaining > 0) await sleep(remaining);
  check('no second beam within 1.2s of the first (cooldown holds)', beamsAfterKill() === 1, `beams=${beamsAfterKill()}`);

  // ----- respawn --------------------------------------------------------------
  console.log('respawn');
  const respawn = await waitForMsg(B, 'respawn for B', (m) => m.type === 'respawn' && m.id === B.id, { from: fromB, timeoutMs: 4000 });
  const respawnDelay = respawn.t - kill.t;
  check('B respawns ~2s after the kill', respawnDelay >= 1600 && respawnDelay <= 3200, `${respawnDelay}ms`);
  await waitForSnap(B, 'B alive again', (s) => s.players.find((p) => p.id === B.id)?.alive === true, 2000);
  check('B alive again in snapshots', true);

  // ----- 7. hygiene ------------------------------------------------------------
  console.log('hygiene (disconnects do not kill the server)');
  A.ws.close();
  B.ws.close();
  await sleep(500);
  check('server process still alive after both clients left', !serverExited);
  const C = await connectAndJoin('C', 'CarolE2E');
  check('a third client can connect and join', C.welcome !== null && C.welcome!.mapName === 'longestyard');
  C.ws.close();
  await sleep(200);
}

// --------------------------------- run --------------------------------------

(async () => {
  console.log('e2e netcode test');
  if (await probePort(PORT)) {
    console.error(`  FAIL  port ${PORT} is already in use — kill the stale process and re-run`);
    process.exit(1);
  }
  const watchdog = setTimeout(() => {
    console.error('  FAIL  global watchdog (120s) fired — aborting');
    process.exit(1);
  }, 120000);
  watchdog.unref();

  const server = startServer();
  try {
    await main(server);
  } catch (err) {
    if (err instanceof HardFail) {
      console.error(`\naborted: ${err.message}`);
    } else {
      console.error('\nunexpected error:', err);
    }
    failures++;
  } finally {
    killTree(server);
  }
  console.log(failures ? `\n${failures} FAILURE(S)` : '\nall e2e tests passed');
  process.exit(failures ? 1 : 0);
})();
