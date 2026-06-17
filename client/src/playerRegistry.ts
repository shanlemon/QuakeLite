import type { PlayerInfo, Standing } from '../../shared/protocol';
import type { ScoreRow } from './types';

export interface ScoreUpdateRow {
  id: number;
  frags: number;
  deaths: number;
  ping: number;
}

export function avatarUrl(p: Pick<PlayerInfo, 'userId' | 'avatar'>): string | null {
  return p.avatar ? `https://cdn.discordapp.com/avatars/${p.userId}/${p.avatar}.png?size=64` : null;
}

export function playerName(registry: ReadonlyMap<number, PlayerInfo>, id: number): string {
  return registry.get(id)?.name ?? 'Player';
}

export function playerColor(registry: ReadonlyMap<number, PlayerInfo>, id: number): number {
  return registry.get(id)?.colorIdx ?? 0;
}

export function buildScoreRows(players: Iterable<PlayerInfo>, localId: number): ScoreRow[] {
  return [...players]
    .sort((a, b) => b.frags - a.frags || a.deaths - b.deaths || a.name.localeCompare(b.name))
    .map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: avatarUrl(p),
      colorIdx: p.colorIdx,
      frags: p.frags,
      deaths: p.deaths,
      ping: p.ping,
      afk: p.afk,
      isLocal: p.id === localId,
    }));
}

export function applyScoreRows(registry: Map<number, PlayerInfo>, rows: Iterable<ScoreUpdateRow>): void {
  for (const row of rows) {
    const p = registry.get(row.id);
    if (!p) continue;
    p.frags = row.frags;
    p.deaths = row.deaths;
    p.ping = row.ping;
  }
}

export function topEnemyFrags(players: Iterable<PlayerInfo>, localId: number): number {
  let top = -1;
  for (const p of players) {
    if (p.id !== localId && p.frags > top) top = p.frags;
  }
  return top;
}

export function matchEndRows(standings: Iterable<Standing>): { name: string; colorIdx: number; frags: number; deaths: number }[] {
  return [...standings].map((s) => ({
    name: s.name,
    colorIdx: s.colorIdx,
    frags: s.frags,
    deaths: s.deaths,
  }));
}
