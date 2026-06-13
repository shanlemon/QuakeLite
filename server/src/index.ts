// ---------------------------------------------------------------------------
// QuakeLite server entry point: loads .env from the repo root, then stands up
// one Express app (Discord OAuth token exchange + built-client static files)
// and one WebSocketServer ('/ws') that feeds connections into the per-activity
// room registry. The Discord activity proxy strips '/.proxy', so the routes
// here are the bare '/api/token' and '/ws'.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { handleConnection } from './room';

const rootDir = path.resolve(import.meta.dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// ----- OAuth: exchange the SDK's authorization code for an access token -----
app.post('/api/token', async (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    res.status(503).json({ error: 'OAuth is not configured on this server' });
    return;
  }
  const code: unknown = (req.body as { code?: unknown } | null | undefined)?.code;
  if (typeof code !== 'string' || code.length === 0) {
    res.status(400).json({ error: 'missing code' });
    return;
  }
  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
      }),
    });
    if (!response.ok) {
      // Never log or forward Discord's response body — it can echo credentials.
      const status = response.status >= 400 && response.status < 500 ? response.status : 400;
      res.status(status).json({ error: 'token exchange failed' });
      return;
    }
    const data = (await response.json()) as { access_token?: unknown };
    if (typeof data.access_token !== 'string') {
      res.status(400).json({ error: 'token exchange failed' });
      return;
    }
    res.json({ access_token: data.access_token });
  } catch {
    res.status(400).json({ error: 'token exchange failed' });
  }
});

// ----- Static client (production build; in dev Vite serves the client) ------
const clientDist = path.join(rootDir, 'client', 'dist');
const serveClient = fs.existsSync(clientDist);
if (serveClient) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/ws') {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ------------------------------ HTTP + WS -----------------------------------
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
wss.on('connection', handleConnection);
wss.on('error', (err) => console.error('[ws] server error:', err.message));

const port = Number(process.env.PORT) || 3001;
server.on('error', (err) => {
  console.error('[quakelite] failed to start:', err.message);
  process.exit(1);
});
server.listen(port, () => {
  const oauthConfigured = Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
  console.log(`[quakelite] server listening on http://localhost:${port}`);
  console.log(`[quakelite] game websocket at ws://localhost:${port}/ws`);
  console.log(`[quakelite] oauth token endpoint: ${oauthConfigured ? 'configured' : 'NOT configured (set DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET in .env)'}`);
  console.log(`[quakelite] static client: ${serveClient ? clientDist : 'client/dist not found (dev mode — use the Vite dev server)'}`);
});
