import { clamp } from '../../shared/math';
import type { ScoreRow } from './types';

export interface HudStanding {
  name: string;
  colorIdx: number;
  frags: number;
  deaths: number;
}

export interface SpeedPresentation {
  value: number;
  text: string;
  barFrac: number;
  fast: boolean;
}

function scoreOrder(
  a: Pick<ScoreRow | HudStanding, 'name' | 'frags' | 'deaths'>,
  b: Pick<ScoreRow | HudStanding, 'name' | 'frags' | 'deaths'>,
): number {
  return b.frags - a.frags || a.deaths - b.deaths || a.name.localeCompare(b.name);
}

export function sortScoreRows(rows: readonly ScoreRow[]): ScoreRow[] {
  return rows.slice().sort(scoreOrder);
}

export function sortStandings(rows: readonly HudStanding[]): HudStanding[] {
  return rows.slice().sort(scoreOrder);
}

export function podiumVisualOrder(count: number): number[] {
  const n = Math.min(3, Math.max(0, Math.floor(count)));
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [1, 0];
  return [1, 0, 2];
}

export function formatClock(timeLeftMs: number): string {
  const sec = Math.max(0, Math.ceil(timeLeftMs / 1000));
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

export function formatRespawnCountdown(respawnInMs: number): string {
  return `RESPAWN IN ${(Math.max(0, respawnInMs) / 1000).toFixed(1)}s`;
}

export function formatRestartCountdown(remainingMs: number): string {
  return `NEXT MATCH IN ${Math.max(0, Math.ceil(remainingMs / 1000))}s`;
}

export function leaderText(topEnemyFrags: number): string | null {
  return topEnemyFrags < 0 ? null : `LEADER ${topEnemyFrags}`;
}

export function cooldownFrac(value: number): number {
  return clamp(value, 0, 1);
}

export function presentSpeed(speed: number): SpeedPresentation {
  const value = Math.max(0, Math.round(speed));
  return {
    value,
    text: `${value} ups`,
    barFrac: Math.min(1, value / 800),
    fast: value > 320,
  };
}

export function formatPing(ping: number): string {
  return `PING ${Math.max(0, Math.round(ping))}`;
}
