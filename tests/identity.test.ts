import { resolveJoinIdentity } from '../server/src/identity';
import type { ClientJsonMsg } from '../shared/protocol';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

function join(
  user: Extract<ClientJsonMsg, { type: 'join' }>['user'],
  displayName?: string,
): Extract<ClientJsonMsg, { type: 'join' }> {
  return { type: 'join', instanceId: 'identity-test', user, ...(displayName !== undefined ? { displayName } : {}) };
}

console.log('join identity');
{
  const id = await resolveJoinIdentity(join({ id: 'claimed-discord-id', username: '  Alice\t\nPlayer  ', avatar: 'AbC_1234' }));
  check('guest identity is generated server-side', typeof id?.userId === 'string' && /^guest:[a-f0-9-]{8}$/i.test(id.userId), id?.userId);
  check('guest name is sanitized', id?.name === 'Alice Player', id?.name);
  check('valid guest avatar hash is preserved', id?.avatar === 'AbC_1234', String(id?.avatar));
}

{
  const id = await resolveJoinIdentity(join({ id: 'ignored', username: 'Generated1234', avatar: null }, '  Violet\t\nRail  '));
  check('displayName overrides generated guest name', id?.name === 'Violet Rail', id?.name);
}

{
  const id = await resolveJoinIdentity(join({ id: 'ignored', username: '\x00\x1f   ', avatar: '../../secret' }));
  check('blank sanitized names fall back to Player', id?.name === 'Player', id?.name);
  check('invalid guest avatar hash is dropped', id?.avatar === null, String(id?.avatar));
}

{
  const id = await resolveJoinIdentity(join({ id: 'ignored', username: '0123456789 0123456789 0123456789', avatar: null }));
  check('guest names are capped at 24 chars', id?.name.length === 24, `${id?.name.length}: ${id?.name}`);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall identity tests passed');
if (failures) process.exit(1);
