// Client player registry helper tests - run with: npx tsx tests/playerRegistry.test.ts

import type { PlayerInfo, Standing } from '../shared/protocol';
import {
  applyScoreRows,
  avatarUrl,
  buildScoreRows,
  matchEndRows,
  playerColor,
  playerName,
  topEnemyFrags,
} from '../client/src/playerRegistry';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function player(overrides: Partial<PlayerInfo> = {}): PlayerInfo {
  return {
    id: 1,
    userId: 'user-1',
    name: 'Alice',
    avatar: null,
    colorIdx: 0,
    frags: 0,
    deaths: 0,
    ping: 0,
    afk: false,
    ...overrides,
  };
}

console.log('client player registry');

{
  check(
    'avatarUrl builds Discord CDN URL',
    avatarUrl(player({ userId: '123', avatar: 'hash' })) === 'https://cdn.discordapp.com/avatars/123/hash.png?size=64',
  );
  check('avatarUrl returns null without avatar hash', avatarUrl(player({ avatar: null })) === null);
}

{
  const rows = buildScoreRows(
    [
      player({ id: 1, name: 'Charlie', frags: 4, deaths: 2, colorIdx: 2 }),
      player({ id: 2, name: 'Alice', frags: 7, deaths: 3, colorIdx: 1 }),
      player({ id: 3, name: 'Bob', frags: 7, deaths: 1, colorIdx: 3, avatar: 'b' }),
      player({ id: 4, name: 'Aaron', frags: 4, deaths: 2, colorIdx: 4 }),
    ],
    3,
  );
  check('score rows sort by frags deaths then name', rows.map((r) => r.name).join(',') === 'Bob,Alice,Aaron,Charlie');
  check('score rows mark local player', rows[0]!.isLocal === true && rows.slice(1).every((r) => !r.isLocal));
  check('score rows include avatar URL', rows[0]!.avatarUrl?.includes('/avatars/user-1/b.png?size=64') === true);
}

{
  const registry = new Map<number, PlayerInfo>([
    [1, player({ id: 1, name: 'Alice', colorIdx: 5 })],
    [2, player({ id: 2, name: 'Bob', colorIdx: 6 })],
  ]);
  check('playerName returns registered names', playerName(registry, 2) === 'Bob');
  check('playerName falls back for missing ids', playerName(registry, 999) === 'Player');
  check('playerColor returns registered colors', playerColor(registry, 1) === 5);
  check('playerColor falls back for missing ids', playerColor(registry, 999) === 0);

  applyScoreRows(registry, [
    { id: 1, frags: 9, deaths: 2, ping: 33 },
    { id: 999, frags: 99, deaths: 99, ping: 99 },
  ]);
  check('applyScoreRows updates known players', registry.get(1)?.frags === 9 && registry.get(1)?.ping === 33);
  check('applyScoreRows ignores unknown players', registry.size === 2);
  check('topEnemyFrags ignores local player', topEnemyFrags(registry.values(), 1) === 0);
  check('topEnemyFrags returns -1 when alone', topEnemyFrags([registry.get(1)!], 1) === -1);
}

{
  const standings: Standing[] = [
    { id: 1, name: 'Alice', colorIdx: 2, frags: 5, deaths: 1 },
    { id: 2, name: 'Bob', colorIdx: 3, frags: 4, deaths: 7 },
  ];
  const rows = matchEndRows(standings);
  check('matchEndRows strips ids for HUD contract', JSON.stringify(rows) === '[{"name":"Alice","colorIdx":2,"frags":5,"deaths":1},{"name":"Bob","colorIdx":3,"frags":4,"deaths":7}]');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall player registry tests passed');
if (failures) process.exit(1);
