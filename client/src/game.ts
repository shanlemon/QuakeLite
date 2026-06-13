// ---------------------------------------------------------------------------
// The game orchestrator: client-side prediction + reconciliation for the
// local player, snapshot-buffer interpolation for remotes, local firing
// feedback, and per-frame HUD / audio / renderer wiring.
// ---------------------------------------------------------------------------

import {
  type Vec3,
  vec3,
  clone,
  copy,
  clamp,
  lerp,
  lerpVec,
  lerpAngle,
  distanceSq,
  viewDir,
} from '../../shared/math';
import { EYE_HEIGHT, GAME, PLAYER_MINS, PLAYER_MAXS } from '../../shared/constants';
import { rayVsAABB, traceRay } from '../../shared/collision';
import {
  BUTTON_FIRE,
  BUTTON_JUMP,
  createPmoveState,
  horizontalSpeed,
  pmove,
  type PmoveEvent,
  type PmoveState,
  type UserCmd,
} from '../../shared/movement';
import type { MapDef } from '../../shared/mapdef';
import {
  arrToVec,
  type MatchInfo,
  type PlayerInfo,
  type ServerJsonMsg,
  type Snapshot,
  type SnapshotPlayer,
} from '../../shared/protocol';
import type { AudioSys, Hud, Renderer, RenderPlayer, ScoreRow } from './types';
import type { DiscordContext } from './discord';
import type { InputSys } from './input';
import type { NetClient } from './net';

export type WelcomeMsg = Extract<ServerJsonMsg, { type: 'welcome' }>;

export interface GameDeps {
  net: NetClient;
  input: InputSys;
  renderer: Renderer;
  hud: Hud;
  audio: AudioSys;
  discord: DiscordContext;
  map: MapDef;
  welcome: WelcomeMsg;
}

export interface Game {
  /** Drive one frame; called from the main rAF loop with performance.now(). */
  frame(nowMs: number): void;
  onSnapshot(snap: Snapshot): void;
  onServerMsg(msg: ServerJsonMsg): void;
  onDisconnect(): void;
}

interface PendingCmd {
  cmd: UserCmd;
  /** Predicted feet position after running this cmd. */
  pos: Vec3;
  teleportCount: number;
}

interface InterpSample {
  t: number;
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  teleportCount: number;
}

/** Last rendered state of a remote player (also used for fire raycasts/gibs). */
interface RemoteView {
  pos: Vec3;
  yaw: number;
  pitch: number;
  alive: boolean;
  teleportCount: number;
}

const MIN_FRAME_MS = 4;
const MAX_CMD_MSEC = 100;
const PENDING_CAP = 512;
const INTERP_BUFFER_MS = 1500;
/** Snapshot gaps wider than this are not interpolated across (snap instead). */
const INTERP_MAX_GAP_MS = 250;
/** Squared predicted-vs-authoritative position error that triggers a rewind. */
const RECONCILE_EPS_SQ = 1;
const FOOTSTEP_INTERVAL_MS = 340;
const FOOTSTEP_MIN_SPEED = 150;

export function createGame(d: GameDeps): Game {
  const { net, input, renderer, hud, audio, discord, map } = d;
  const selfId = d.welcome.id;

  const registry = new Map<number, PlayerInfo>();
  for (const p of d.welcome.players) registry.set(p.id, p);
  let match: MatchInfo = d.welcome.match;

  // ---- local player ---------------------------------------------------
  let local: PmoveState = createPmoveState(); // adopted from the first snapshot
  let selfAlive = true;
  let pending: PendingCmd[] = [];
  let seq = 0;
  let lastFireAt = -Infinity;
  let deathAt = 0;
  let lastFootstepAt = 0;
  let lastFrameAt = performance.now();
  let disconnected = false;

  // ---- remote players -------------------------------------------------
  const buffers = new Map<number, InterpSample[]>();
  const remoteViews = new Map<number, RemoteView>();

  hud.setConnectionMessage('');
  pushScoreboard();

  // ------------------------------------------------------------------ //
  //  Scoreboard / registry helpers
  // ------------------------------------------------------------------ //

  function avatarUrl(p: PlayerInfo): string | null {
    return p.avatar
      ? `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64`
      : null;
  }

  function pushScoreboard(): void {
    const rows: ScoreRow[] = [...registry.values()]
      .sort((a, b) => b.frags - a.frags || a.deaths - b.deaths || a.name.localeCompare(b.name))
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatarUrl: avatarUrl(p),
        colorIdx: p.colorIdx,
        frags: p.frags,
        deaths: p.deaths,
        ping: p.ping,
        isLocal: p.id === selfId,
      }));
    hud.updateScoreboard(rows);
  }

  function nameOf(id: number): string {
    return registry.get(id)?.name ?? 'Player';
  }
  function colorOf(id: number): number {
    return registry.get(id)?.colorIdx ?? 0;
  }

  // ------------------------------------------------------------------ //
  //  Prediction
  // ------------------------------------------------------------------ //

  function onLocalEvent(ev: PmoveEvent): void {
    switch (ev.type) {
      case 'jump':
        audio.play('jump');
        break;
      case 'land':
        audio.play('land', { volume: clamp(ev.impactSpeed / 600, 0.3, 1) });
        break;
      case 'jumppad':
        audio.play('pad');
        break;
      case 'teleport':
        // Reorient the actual view yaw to the destination portal's facing.
        // The cmd that triggered this already went out with the old yaw —
        // the server simulates it identically, and the next cmds carry the
        // rotated yaw.
        input.addYaw(ev.yawDelta);
        hud.flash('rgba(150, 190, 255, 0.5)', 350);
        audio.play('teleport');
        break;
    }
  }

  function fireLocal(): void {
    lastFireAt = performance.now();
    const yaw = input.getYaw();
    const pitch = input.getPitch();
    const eye = vec3(local.pos.x, local.pos.y + EYE_HEIGHT, local.pos.z);
    const dir = viewDir(yaw, pitch);

    // Cosmetic beam endpoint: nearer of world geometry and any remote hull.
    // The server is authoritative on the actual hit.
    const world = traceRay(eye, dir, GAME.RAIL_RANGE, map.brushes);
    let dist = world.fraction * GAME.RAIL_RANGE;
    let hitWorld = world.fraction < 1;
    for (const rv of remoteViews.values()) {
      if (!rv.alive) continue;
      const box = {
        min: vec3(rv.pos.x + PLAYER_MINS.x, rv.pos.y + PLAYER_MINS.y, rv.pos.z + PLAYER_MINS.z),
        max: vec3(rv.pos.x + PLAYER_MAXS.x, rv.pos.y + PLAYER_MAXS.y, rv.pos.z + PLAYER_MAXS.z),
      };
      const t = rayVsAABB(eye, dir, box, dist);
      if (t !== null && t < dist) {
        dist = t;
        hitWorld = false;
      }
    }
    const end = vec3(eye.x + dir.x * dist, eye.y + dir.y * dist, eye.z + dir.z * dist);

    const colorIdx = colorOf(selfId);
    renderer.spawnBeam(eye, end, colorIdx);
    if (hitWorld) renderer.spawnImpact(end, colorIdx);
    renderer.triggerRecoil();
    audio.play('fire');
  }

  // ------------------------------------------------------------------ //
  //  Reconciliation
  // ------------------------------------------------------------------ //

  function adoptAuthoritative(s: SnapshotPlayer): void {
    copy(local.pos, s.pos);
    copy(local.vel, s.vel);
    local.onGround = s.onGround;
    local.groundNormal = s.onGround ? vec3(0, 1, 0) : null;
    local.teleportCount = s.teleportCount;
    local.padTouchId = s.padTouchId;
  }

  function reconcile(self: SnapshotPlayer, ackSeq: number): void {
    selfAlive = self.alive;

    // Drop acked commands, remembering the record matching ackSeq exactly.
    let acked: PendingCmd | null = null;
    while (pending.length > 0 && pending[0]!.cmd.seq <= ackSeq) {
      const rec = pending.shift()!;
      if (rec.cmd.seq === ackSeq) acked = rec;
    }

    if (!self.alive || match.state !== 'playing') {
      // Not predicting — the server owns the state outright.
      adoptAuthoritative(self);
      pending.length = 0;
      return;
    }

    if (
      acked &&
      acked.teleportCount === self.teleportCount &&
      distanceSq(acked.pos, self.pos) <= RECONCILE_EPS_SQ
    ) {
      return; // prediction matched — keep the locally simulated state
    }

    // Misprediction (or no record for ackSeq, e.g. right after spawn):
    // rewind to the authoritative state and replay the unacked commands.
    // Events/sounds are suppressed during replay, and we deliberately do NOT
    // touch the view yaw even if the replay traverses a portal differently
    // than the original prediction — the server doesn't own view angles, and
    // a mispredicted portal traversal self-corrects within a snapshot or two.
    // Deterministic and simple beats clever here.
    adoptAuthoritative(self);
    for (const rec of pending) {
      pmove(local, rec.cmd, map);
      // Refresh the records so future comparisons use the replayed result —
      // otherwise one rewind cascades into spurious rewinds until the input
      // pipeline flushes.
      copy(rec.pos, local.pos);
      rec.teleportCount = local.teleportCount;
    }
  }

  // ------------------------------------------------------------------ //
  //  Remote interpolation
  // ------------------------------------------------------------------ //

  function bufferSnapshotPlayer(p: SnapshotPlayer, t: number): void {
    let buf = buffers.get(p.id);
    if (!buf) {
      buf = [];
      buffers.set(p.id, buf);
    }
    if (buf.length > 0 && t <= buf[buf.length - 1]!.t) return; // out of order
    buf.push({
      t,
      pos: p.pos,
      yaw: p.yaw,
      pitch: p.pitch,
      alive: p.alive,
      teleportCount: p.teleportCount,
    });
  }

  function sampleBuffer(buf: InterpSample[], renderTime: number): InterpSample {
    const newest = buf[buf.length - 1]!;
    if (renderTime >= newest.t) return newest; // hold newest — no extrapolation
    if (renderTime <= buf[0]!.t) return buf[0]!;
    let i = buf.length - 2;
    while (i > 0 && buf[i]!.t > renderTime) i--;
    const a = buf[i]!;
    const b = buf[i + 1]!;
    // Never interpolate across a teleport or a long gap — snap to the newer.
    if (a.teleportCount !== b.teleportCount || b.t - a.t > INTERP_MAX_GAP_MS) return b;
    const t = (renderTime - a.t) / (b.t - a.t);
    return {
      t: renderTime,
      pos: lerpVec(vec3(), a.pos, b.pos, t),
      yaw: lerpAngle(a.yaw, b.yaw, t),
      pitch: lerp(a.pitch, b.pitch, t),
      alive: b.alive,
      teleportCount: b.teleportCount,
    };
  }

  function updateRemoteViews(renderTime: number): void {
    for (const [id, buf] of buffers) {
      if (buf.length === 0) continue;
      const newestT = buf[buf.length - 1]!.t;
      while (buf.length > 2 && newestT - buf[0]!.t > INTERP_BUFFER_MS) buf.shift();

      const s = sampleBuffer(buf, renderTime);
      const view = remoteViews.get(id);
      if (view) {
        if (s.teleportCount !== view.teleportCount) {
          // Positional whoosh at the arrival point.
          audio.play('teleport', { pos: s.pos });
        }
        copy(view.pos, s.pos);
        view.yaw = s.yaw;
        view.pitch = s.pitch;
        view.alive = s.alive;
        view.teleportCount = s.teleportCount;
      } else {
        remoteViews.set(id, {
          pos: clone(s.pos),
          yaw: s.yaw,
          pitch: s.pitch,
          alive: s.alive,
          teleportCount: s.teleportCount,
        });
      }
    }
  }

  // ------------------------------------------------------------------ //
  //  Server events
  // ------------------------------------------------------------------ //

  function handleKill(killerId: number, victimId: number): void {
    const killer = registry.get(killerId);
    const victim = registry.get(victimId);
    // killer === victim is the server's void-fall suicide.
    const isVoidDeath = killerId === victimId;
    hud.addKill(
      isVoidDeath ? 'THE VOID' : nameOf(killerId),
      colorOf(killerId),
      nameOf(victimId),
      colorOf(victimId),
      killerId === selfId || victimId === selfId,
    );

    const gibPos =
      victimId === selfId ? clone(local.pos) : remoteViews.get(victimId)?.pos ?? null;
    if (gibPos) {
      renderer.spawnGibs(clone(gibPos), colorOf(victimId));
      audio.play('death', { pos: gibPos });
    }

    // Optimistic local bookkeeping — the authoritative 'scores' message that
    // follows overwrites these with absolute values.
    if (killer && killerId !== victimId) killer.frags += 1;
    if (victim) victim.deaths += 1;

    if (victimId === selfId) {
      selfAlive = false;
      deathAt = performance.now();
      pending.length = 0;
      hud.flash('rgba(255, 32, 32, 0.45)', 600);
      if (isVoidDeath) hud.showMessage('You drifted into the void', 2000);
    }
    if (killerId === selfId && victimId !== selfId) {
      audio.play('frag');
      hud.showMessage(`You fragged ${nameOf(victimId)}`, 2000);
      discord.updateActivity(killer?.frags ?? 0);
    }
    pushScoreboard();
  }

  function handleRespawn(msg: Extract<ServerJsonMsg, { type: 'respawn' }>): void {
    if (msg.id === selfId) {
      local = createPmoveState(arrToVec(msg.pos));
      pending.length = 0;
      input.setView(msg.yaw, 0);
      selfAlive = true;
      deathAt = 0;
      hud.flash('rgba(160, 220, 255, 0.35)', 400);
      audio.play('respawn');
    } else {
      // Stale pre-death samples would interpolate across half the map.
      buffers.delete(msg.id);
      remoteViews.delete(msg.id);
    }
  }

  function onServerMsg(msg: ServerJsonMsg): void {
    switch (msg.type) {
      case 'playerJoin':
        registry.set(msg.player.id, msg.player);
        hud.showMessage(`${msg.player.name} joined`, 2000);
        pushScoreboard();
        break;
      case 'playerLeave': {
        const name = nameOf(msg.id);
        registry.delete(msg.id);
        buffers.delete(msg.id);
        remoteViews.delete(msg.id);
        hud.showMessage(`${name} left`, 2000);
        pushScoreboard();
        break;
      }
      case 'beam': {
        if (msg.shooter === selfId) break; // own shots are rendered at fire time
        const from = arrToVec(msg.from);
        const to = arrToVec(msg.to);
        const c = colorOf(msg.shooter);
        renderer.spawnBeam(from, to, c);
        audio.play('fire', { pos: from });
        if (msg.hit === undefined) renderer.spawnImpact(to, c);
        break;
      }
      case 'kill':
        handleKill(msg.killer, msg.victim);
        break;
      case 'respawn':
        handleRespawn(msg);
        break;
      case 'scores': {
        for (const row of msg.rows) {
          const p = registry.get(row.id);
          if (!p) continue;
          p.frags = row.frags;
          p.deaths = row.deaths;
          p.ping = row.ping;
        }
        pushScoreboard();
        discord.updateActivity(registry.get(selfId)?.frags ?? 0);
        break;
      }
      case 'matchStart':
        match = msg.match;
        pending.length = 0;
        lastFireAt = -Infinity;
        hud.hideMatchEnd();
        hud.showMessage('FIGHT!', 1500);
        break;
      case 'matchEnd':
        match = { state: 'intermission', endsAt: msg.restartAt, fragLimit: match.fragLimit };
        hud.showMatchEnd(
          msg.standings.map((s) => ({
            name: s.name,
            colorIdx: s.colorIdx,
            frags: s.frags,
            deaths: s.deaths,
          })),
          Math.max(0, msg.restartAt - net.estServerTime()),
        );
        audio.play('matchEnd');
        break;
      case 'error':
        hud.setConnectionMessage(msg.message);
        break;
      case 'welcome': // handled at construction (main.ts)
      case 'pong': // handled inside net.ts
        break;
    }
  }

  function onSnapshot(snap: Snapshot): void {
    for (const p of snap.players) {
      if (p.id === selfId) reconcile(p, snap.ackSeq);
      else bufferSnapshotPlayer(p, snap.serverTime);
    }
  }

  // ------------------------------------------------------------------ //
  //  Frame
  // ------------------------------------------------------------------ //

  function frame(now: number): void {
    if (disconnected) return;
    const dtMs = now - lastFrameAt;
    if (dtMs < MIN_FRAME_MS) return; // accumulate (240 Hz+ displays)
    lastFrameAt = now;
    const dt = Math.min(dtMs, 100) / 1000;

    const renderTime = net.estServerTime() - GAME.INTERP_DELAY_MS;
    updateRemoteViews(renderTime);

    // ---- build, predict and send this frame's command ----
    const s = input.sample();
    const playing = match.state === 'playing';
    const predicting = selfAlive && playing;
    const cooldownReady = now - lastFireAt >= GAME.FIRE_COOLDOWN_MS;

    let buttons = 0;
    if (predicting) {
      buttons = s.buttons & BUTTON_JUMP;
      if ((s.buttons & BUTTON_FIRE) !== 0 && cooldownReady) buttons |= BUTTON_FIRE;
    }

    const cmd: UserCmd = {
      seq: ++seq,
      msec: clamp(Math.round(dtMs), 1, MAX_CMD_MSEC),
      yaw: s.yaw,
      pitch: s.pitch,
      fmove: predicting ? s.fmove : 0,
      smove: predicting ? s.smove : 0,
      buttons,
      interpTime: Math.max(0, Math.floor(renderTime)),
    };

    if (predicting) {
      const events = pmove(local, cmd, map);
      for (const ev of events) onLocalEvent(ev);
      pending.push({ cmd, pos: clone(local.pos), teleportCount: local.teleportCount });
      if (pending.length > PENDING_CAP) pending.splice(0, pending.length - PENDING_CAP);
      if ((cmd.buttons & BUTTON_FIRE) !== 0) fireLocal();
    }
    net.sendInput(cmd); // dead/intermission still sends empty cmds (keeps acks flowing)

    // ---- footsteps ----
    const speed = horizontalSpeed(local);
    if (
      predicting &&
      local.onGround &&
      speed > FOOTSTEP_MIN_SPEED &&
      now - lastFootstepAt > FOOTSTEP_INTERVAL_MS
    ) {
      lastFootstepAt = now;
      audio.play('footstep');
    }

    // ---- HUD ----
    const me = registry.get(selfId);
    let topEnemyFrags = -1;
    for (const p of registry.values()) {
      if (p.id !== selfId && p.frags > topEnemyFrags) topEnemyFrags = p.frags;
    }
    hud.setStats({
      frags: me?.frags ?? 0,
      topEnemyFrags,
      cooldownFrac: Math.min(1, (now - lastFireAt) / GAME.FIRE_COOLDOWN_MS),
      speed,
      ping: Math.round(net.getRtt()),
      timeLeftMs: Math.max(0, match.endsAt - net.estServerTime()),
      alive: selfAlive,
      respawnInMs: selfAlive ? 0 : Math.max(0, GAME.RESPAWN_DELAY_MS - (now - deathAt)),
    });

    // ---- audio listener + render ----
    const yaw = input.getYaw();
    const pitch = input.getPitch();
    const eye = vec3(local.pos.x, local.pos.y + EYE_HEIGHT, local.pos.z);
    audio.setListener(eye, yaw);

    const players: RenderPlayer[] = [
      {
        id: selfId,
        pos: local.pos,
        yaw,
        pitch,
        colorIdx: me?.colorIdx ?? 0,
        alive: selfAlive,
        name: me?.name ?? 'You',
        isLocal: true,
      },
    ];
    for (const [id, rv] of remoteViews) {
      if (!rv.alive) continue;
      players.push({
        id,
        pos: rv.pos,
        yaw: rv.yaw,
        pitch: rv.pitch,
        colorIdx: colorOf(id),
        alive: true,
        name: nameOf(id),
        isLocal: false,
      });
    }

    renderer.render(
      dt,
      { pos: eye, yaw, pitch, fov: hud.getSettings().fov },
      players,
      now,
    );
  }

  function onDisconnect(): void {
    disconnected = true;
  }

  return { frame, onSnapshot, onServerMsg, onDisconnect };
}
