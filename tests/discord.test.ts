import { exchangeDiscordCode, verifyDiscordUser } from '../server/src/discord';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const originalFetch = globalThis.fetch;
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

console.log('discord api');
try {
  let tokenRequest = '';
  globalThis.fetch = async (input, init) => {
    tokenRequest = `${String(input)} ${String(init?.body)}`;
    return jsonResponse(200, { access_token: 'token-123' });
  };
  const exchange = await exchangeDiscordCode({ clientId: 'client', clientSecret: 'secret', code: 'code-abc' });
  check('token exchange returns access token', exchange.ok && exchange.accessToken === 'token-123');
  check('token exchange posts to oauth endpoint', tokenRequest.includes('/oauth2/token'), tokenRequest);
  check('token exchange sends required form fields', tokenRequest.includes('grant_type=authorization_code') && tokenRequest.includes('code=code-abc'));

  globalThis.fetch = async () => jsonResponse(503, { error: 'upstream' });
  const failedExchange = await exchangeDiscordCode({ clientId: 'client', clientSecret: 'secret', code: 'bad' });
  check('token exchange maps upstream failures to safe status', !failedExchange.ok && failedExchange.status === 400, JSON.stringify(failedExchange));

  globalThis.fetch = async () =>
    jsonResponse(200, { id: '42', username: 'raw-name', global_name: 'Display Name', avatar: 'avatarhash' });
  const user = await verifyDiscordUser('token');
  check('user verification prefers global display name', user?.username === 'Display Name', user?.username);
  check('user verification preserves avatar hash', user?.avatar === 'avatarhash', String(user?.avatar));

  globalThis.fetch = async () => jsonResponse(200, { username: 'missing-id' });
  const invalidUser = await verifyDiscordUser('token');
  check('user verification rejects malformed payloads', invalidUser === null, JSON.stringify(invalidUser));
} finally {
  globalThis.fetch = originalFetch;
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall discord api tests passed');
if (failures) process.exit(1);
