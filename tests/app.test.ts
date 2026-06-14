import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { createApp, type AppOptions } from '../server/src/app';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const originalFetch = globalThis.fetch;

async function withApp(
  options: Partial<AppOptions>,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const { app } = createApp({
    clientDist: path.join(process.cwd(), '__missing_client_dist__'),
    ...options,
  });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err?: Error) => (err ? reject(err) : resolve()));
    });
  }
}

async function postJson(baseUrl: string, body: unknown): Promise<{ status: number; body: unknown; headers: Headers }> {
  const res = await originalFetch(`${baseUrl}/api/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json(), headers: res.headers };
}

console.log('server app');
try {
  await withApp({}, async (baseUrl) => {
    const res = await postJson(baseUrl, { code: 'abc' });
    check('token endpoint reports missing OAuth config', res.status === 503, JSON.stringify(res.body));
    check('x-powered-by header is disabled', res.headers.get('x-powered-by') === null);
  });

  await withApp({ discordClientId: 'client', discordClientSecret: 'secret' }, async (baseUrl) => {
    const missing = await postJson(baseUrl, {});
    check('token endpoint validates missing code', missing.status === 400, JSON.stringify(missing.body));

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ access_token: 'access-from-discord' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    const ok = await postJson(baseUrl, { code: 'valid-code' });
    check('token endpoint returns exchanged access token', ok.status === 200, JSON.stringify(ok.body));
    check(
      'token endpoint response shape is minimal',
      JSON.stringify(ok.body) === JSON.stringify({ access_token: 'access-from-discord' }),
      JSON.stringify(ok.body),
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: 'do not forward' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    const failed = await postJson(baseUrl, { code: 'bad-code' });
    check('token endpoint maps Discord failures', failed.status === 401, JSON.stringify(failed.body));
    check(
      'token endpoint does not forward Discord error bodies',
      JSON.stringify(failed.body) === JSON.stringify({ error: 'token exchange failed' }),
      JSON.stringify(failed.body),
    );
  });
} finally {
  globalThis.fetch = originalFetch;
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall server app tests passed');
if (failures) process.exit(1);
