import { clamp } from '../../shared/math';
import type { MapDef } from '../../shared/mapdef';
import { BUTTON_FIRE, pmove, type PmoveState, type UserCmd } from '../../shared/movement';
import type { MatchState } from '../../shared/protocol';

export const INPUT_QUEUE_CAP = 128;
/** Anti-speedhack: budget accrues at 1.25x real time, capped at 400 ms. */
export const MSEC_BUDGET_RATE = 1.25;
export const MSEC_BUDGET_CAP = 400;

export interface CommandPlayer {
  state: PmoveState;
  alive: boolean;
  yaw: number;
  pitch: number;
  inputQueue: UserCmd[];
  /** Highest input seq processed (acked in snapshots). */
  lastAckSeq: number;
  /** False until the first cmd is processed (so a client may start at seq 0). */
  acked: boolean;
  msecBudget: number;
}

export function enqueueInputCommand(player: CommandPlayer, cmd: UserCmd, cap = INPUT_QUEUE_CAP): void {
  if (player.inputQueue.length >= cap) player.inputQueue.shift();
  player.inputQueue.push(cmd);
}

export function accrueInputBudget(
  players: Iterable<CommandPlayer>,
  elapsedMs: number,
  rate = MSEC_BUDGET_RATE,
  cap = MSEC_BUDGET_CAP,
): void {
  const gain = Math.max(0, elapsedMs) * rate;
  for (const p of players) p.msecBudget = Math.min(cap, p.msecBudget + gain);
}

export interface ProcessInputOptions<P extends CommandPlayer> {
  map: MapDef;
  now: number;
  gameState: MatchState;
  players: P[];
  tryFire(player: P, cmd: UserCmd, now: number, players: P[]): void;
}

export function processInputQueue<P extends CommandPlayer>(
  player: P,
  { map, now, gameState, players, tryFire }: ProcessInputOptions<P>,
): void {
  const queue = player.inputQueue;
  if (queue.length === 0) return;

  queue.sort((a, b) => a.seq - b.seq);
  for (const cmd of queue) {
    if (player.acked && cmd.seq <= player.lastAckSeq) continue; // dupe / stale
    player.acked = true;
    player.lastAckSeq = cmd.seq;
    cmd.pitch = clamp(cmd.pitch, -Math.PI / 2, Math.PI / 2);
    player.yaw = cmd.yaw;
    player.pitch = cmd.pitch;

    const msec = clamp(Math.round(cmd.msec), 1, 250);
    if (msec > player.msecBudget) continue; // beyond budget: dropped, but acked
    player.msecBudget -= msec;

    // Dead players and intermission still consume cmds; they just do not move.
    if (gameState === 'playing' && player.alive) {
      pmove(player.state, cmd, map);
      if ((cmd.buttons & BUTTON_FIRE) !== 0) tryFire(player, cmd, now, players);
    }
  }
  queue.length = 0;
}

export function initialMsecBudget(): number {
  // Headroom so the client's first cmds after the welcome are not dropped.
  return MSEC_BUDGET_CAP / 2;
}
