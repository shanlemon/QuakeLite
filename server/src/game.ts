// ---------------------------------------------------------------------------
// Match rules for one room: firing + lag-compensated hit resolution, kills,
// respawns (farthest-from-enemies spawn selection), frag/time limits, and the
// intermission → restart cycle. Networking lives in room.ts; this module only
// mutates GamePlayer state and emits ServerJsonMsg through a broadcast hook.
// ---------------------------------------------------------------------------

import { rayVsAABB, traceRay } from '../../shared/collision';
import { EYE_HEIGHT, GAME, PLAYER_MAXS, PLAYER_MINS } from '../../shared/constants';
import { clamp, copy, distanceSq, ma, vec3, viewDir } from '../../shared/math';
import { pointInAABB, type MapDef, type SpawnDef } from '../../shared/mapdef';
import { createPmoveState, type PmoveState, type UserCmd } from '../../shared/movement';
import {
  vecToArr,
  type MatchInfo,
  type MatchState,
  type ServerJsonMsg,
  type Standing,
} from '../../shared/protocol';
import type { LagCompHistory } from './lagcomp';

/** Early-fire tolerance vs. the cooldown schedule (~±2 ticks + jitter). */
const FIRE_COOLDOWN_SLACK_MS = 60;

/** The simulation-facing view of a player (room.ts extends this with I/O). */
export interface GamePlayer {
  id: number;
  name: string;
  colorIdx: number;
  state: PmoveState;
  alive: boolean;
  frags: number;
  deaths: number;
  /** Latest view angles seen in this player's input cmds. */
  yaw: number;
  pitch: number;
  /** Round-trip time reported by the client (for the scoreboard). */
  ping: number;
  /** Schedule anchor: earliest server time the next rail shot is allowed. */
  nextFireAt: number;
  /** Server time to respawn at, or null if no respawn is pending. */
  respawnAt: number | null;
  history: LagCompHistory;
}

export class Game {
  state: MatchState = 'playing';
  /** When the match ends (state 'playing') or restarts (state 'intermission'). */
  endsAt: number;

  constructor(
    private readonly map: MapDef,
    private readonly broadcast: (msg: ServerJsonMsg) => void,
    now: number,
  ) {
    this.endsAt = now + GAME.TIME_LIMIT_MS;
  }

  matchInfo(): MatchInfo {
    return { state: this.state, endsAt: this.endsAt, fragLimit: GAME.FRAG_LIMIT };
  }

  /** Per-tick housekeeping: pending respawns, world bounds, match end/restart. */
  update(now: number, players: GamePlayer[]): void {
    if (this.state === 'playing') {
      for (const p of players) {
        if (this.state !== 'playing') break; // an out-of-bounds kill below may end the match
        if (p.alive) {
          // Safety net: anything that escapes the world counts as a suicide.
          if (!pointInAABB(p.state.pos, this.map.bounds)) this.kill(p, p, now, players);
        } else if (p.respawnAt !== null && now >= p.respawnAt) {
          this.spawnPlayer(p, players);
        }
      }
      if (this.state === 'playing' && now >= this.endsAt) this.endMatch(now, players);
    } else if (now >= this.endsAt) {
      this.restart(now, players);
    }
  }

  /**
   * Resolve one rail shot. The caller guarantees the cmd was applied (within
   * the msec budget); match state, life and cooldown are checked here.
   */
  tryFire(shooter: GamePlayer, cmd: UserCmd, now: number, players: GamePlayer[]): void {
    if (this.state !== 'playing' || !shooter.alive) return;
    // The client fires on the first frame ITS clock shows the cooldown
    // elapsed; frame quantization + delivery jitter + tick alignment make the
    // server-observed spacing wobble by ~±2 ticks. A zero-tolerance check
    // would silently eat 10-30% of held-fire shots, so allow a small early
    // window but advance the anchor on the schedule (never from `now` when
    // early) so the average rate can never exceed one shot per cooldown.
    if (now < shooter.nextFireAt - FIRE_COOLDOWN_SLACK_MS) return;
    shooter.nextFireAt = Math.max(shooter.nextFireAt, now) + GAME.FIRE_COOLDOWN_MS;

    const eye = vec3(shooter.state.pos.x, shooter.state.pos.y + EYE_HEIGHT, shooter.state.pos.z);
    const dir = viewDir(cmd.yaw, cmd.pitch);
    const world = traceRay(eye, dir, GAME.RAIL_RANGE, this.map.brushes, this.map.prisms);
    const worldDist = world.fraction * GAME.RAIL_RANGE;

    // Rewind everyone else to the time the shooter was rendering them.
    const rewindTime = clamp(cmd.interpTime, now - GAME.LAGCOMP_MAX_REWIND_MS, now);
    let victim: GamePlayer | null = null;
    let bestT = worldDist;
    const rewound = vec3();
    for (const q of players) {
      if (q === shooter || !q.alive) continue;
      if (!q.history.query(rewindTime, rewound)) copy(rewound, q.state.pos);
      const box = {
        min: vec3(rewound.x + PLAYER_MINS.x, rewound.y + PLAYER_MINS.y, rewound.z + PLAYER_MINS.z),
        max: vec3(rewound.x + PLAYER_MAXS.x, rewound.y + PLAYER_MAXS.y, rewound.z + PLAYER_MAXS.z),
      };
      const t = rayVsAABB(eye, dir, box, bestT);
      if (t !== null && t < bestT) {
        bestT = t;
        victim = q;
      }
    }

    const to = victim ? ma(vec3(), eye, dir, bestT) : world.endpos;
    this.broadcast({
      type: 'beam',
      shooter: shooter.id,
      from: vecToArr(eye),
      to: vecToArr(to),
      ...(victim ? { hit: victim.id } : {}),
    });
    if (victim) this.kill(shooter, victim, now, players);
  }

  /** killer === victim is a suicide (out-of-world): frag deducted instead. */
  kill(killer: GamePlayer, victim: GamePlayer, now: number, players: GamePlayer[]): void {
    if (!victim.alive) return;
    if (killer === victim) killer.frags--;
    else killer.frags++;
    victim.deaths++;
    victim.alive = false;
    victim.respawnAt = now + GAME.RESPAWN_DELAY_MS;
    this.broadcast({ type: 'kill', killer: killer.id, victim: victim.id });
    this.broadcastScores(players);
    if (this.state === 'playing' && killer.frags >= GAME.FRAG_LIMIT) this.endMatch(now, players);
  }

  /** Spawn (or respawn) a player and tell everyone. */
  spawnPlayer(p: GamePlayer, players: GamePlayer[]): void {
    this.spawnAt(p, this.pickSpawn(p, players));
  }

  broadcastScores(players: GamePlayer[]): void {
    this.broadcast({
      type: 'scores',
      rows: players.map((p) => ({ id: p.id, frags: p.frags, deaths: p.deaths, ping: p.ping })),
    });
  }

  private spawnAt(p: GamePlayer, spawn: SpawnDef): void {
    p.state = createPmoveState(spawn.pos);
    p.alive = true;
    p.respawnAt = null;
    p.yaw = spawn.yaw;
    p.pitch = 0;
    p.history.reset();
    this.broadcast({ type: 'respawn', id: p.id, pos: vecToArr(spawn.pos), yaw: spawn.yaw });
  }

  /** Spawn point with the greatest distance to the nearest living enemy. */
  private pickSpawn(forPlayer: GamePlayer, players: GamePlayer[]): SpawnDef {
    const spawns = this.map.spawns;
    const enemies = players.filter((q) => q !== forPlayer && q.alive);
    if (enemies.length === 0) return spawns[Math.floor(Math.random() * spawns.length)]!;
    let best = spawns[0]!;
    let bestDist = -1;
    for (const s of spawns) {
      let minD = Infinity;
      for (const e of enemies) minD = Math.min(minD, distanceSq(s.pos, e.state.pos));
      if (minD > bestDist) {
        bestDist = minD;
        best = s;
      }
    }
    return best;
  }

  private standings(players: GamePlayer[]): Standing[] {
    return [...players]
      .sort((a, b) => b.frags - a.frags || a.deaths - b.deaths)
      .map((p) => ({ id: p.id, name: p.name, colorIdx: p.colorIdx, frags: p.frags, deaths: p.deaths }));
  }

  private endMatch(now: number, players: GamePlayer[]): void {
    this.state = 'intermission';
    this.endsAt = now + GAME.INTERMISSION_MS;
    for (const p of players) p.respawnAt = null; // dead players sit out the intermission
    this.broadcast({ type: 'matchEnd', standings: this.standings(players), restartAt: this.endsAt });
  }

  private restart(now: number, players: GamePlayer[]): void {
    this.state = 'playing';
    this.endsAt = now + GAME.TIME_LIMIT_MS;
    for (const p of players) {
      p.frags = 0;
      p.deaths = 0;
      p.nextFireAt = 0;
      p.respawnAt = null;
    }
    this.broadcast({ type: 'matchStart', match: this.matchInfo() });
    // Everyone respawns at a distinct spawn point (round-robin if more players
    // than spawns).
    const order = this.map.spawns.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    players.forEach((p, i) => this.spawnAt(p, this.map.spawns[order[i % order.length]!]!));
  }
}
