// HUD presenter tests - run with: npx tsx tests/hudPresenter.test.ts

import {
  cooldownFrac,
  formatClock,
  formatPing,
  formatRespawnCountdown,
  formatRestartCountdown,
  leaderText,
  podiumVisualOrder,
  presentSpeed,
  sortScoreRows,
  sortStandings,
  type HudStanding,
} from '../client/src/hudPresenter';
import type { ScoreRow } from '../client/src/types';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log('hud presenter');

{
  check('formatClock ceilings positive time', formatClock(61_001) === '1:02', formatClock(61_001));
  check('formatClock clamps negative time', formatClock(-10) === '0:00', formatClock(-10));
  check('formatRespawnCountdown uses tenths', formatRespawnCountdown(1249) === 'RESPAWN IN 1.2s');
  check('formatRestartCountdown ceilings seconds', formatRestartCountdown(1) === 'NEXT MATCH IN 1s');
}

{
  check('leaderText hides when no enemy exists', leaderText(-1) === null);
  check('leaderText formats enemy frags', leaderText(12) === 'LEADER 12');
  check('formatPing clamps and rounds', formatPing(-4.4) === 'PING 0' && formatPing(31.6) === 'PING 32');
  check('cooldownFrac clamps to ui range', cooldownFrac(-1) === 0 && cooldownFrac(2) === 1 && cooldownFrac(0.4) === 0.4);
}

{
  const slow = presentSpeed(319.5);
  const fast = presentSpeed(801);
  check('presentSpeed rounds value and formats text', slow.value === 320 && slow.text === '320 ups');
  check('presentSpeed flags fast only above 320 ups', !slow.fast && fast.fast);
  check('presentSpeed caps bar fraction', fast.barFrac === 1);
}

{
  const rows: ScoreRow[] = [
    { id: 1, name: 'Zed', avatarUrl: null, colorIdx: 0, frags: 4, deaths: 2, ping: 50, afk: false, isLocal: false },
    { id: 2, name: 'Ada', avatarUrl: null, colorIdx: 1, frags: 4, deaths: 1, ping: 40, afk: false, isLocal: true },
    { id: 3, name: 'Ben', avatarUrl: null, colorIdx: 2, frags: 4, deaths: 1, ping: 30, afk: false, isLocal: false },
    { id: 4, name: 'Cal', avatarUrl: null, colorIdx: 3, frags: 5, deaths: 8, ping: 20, afk: false, isLocal: false },
  ];
  const sorted = sortScoreRows(rows);
  check('sortScoreRows orders by frags, deaths, then name', sorted.map((r) => r.name).join(',') === 'Cal,Ada,Ben,Zed');
  check('sortScoreRows does not mutate input', rows[0]?.name === 'Zed');
}

{
  const standings: HudStanding[] = [
    { name: 'Beta', colorIdx: 0, frags: 2, deaths: 0 },
    { name: 'Alpha', colorIdx: 1, frags: 2, deaths: 0 },
    { name: 'Winner', colorIdx: 2, frags: 5, deaths: 9 },
  ];
  check('sortStandings shares scoreboard ordering', sortStandings(standings).map((r) => r.name).join(',') === 'Winner,Alpha,Beta');
  check('podiumVisualOrder centers the winner for top three', podiumVisualOrder(3).join(',') === '1,0,2');
  check('podiumVisualOrder handles short podiums', podiumVisualOrder(2).join(',') === '1,0' && podiumVisualOrder(1).join(',') === '0');
  check('podiumVisualOrder clamps invalid counts', podiumVisualOrder(-1).length === 0 && podiumVisualOrder(99).join(',') === '1,0,2');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall hud presenter tests passed');
if (failures) process.exit(1);
