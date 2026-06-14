// ---------------------------------------------------------------------------
// QuakeLite server entry point: loads .env from the repo root, builds the HTTP
// app, attaches one WebSocketServer ('/ws'), and starts listening.
// ---------------------------------------------------------------------------

import http from 'node:http';
import path from 'node:path';
import dotenv from 'dotenv';
import { WebSocketServer } from 'ws';
import { createApp } from './app';
import { handleConnection } from './connection';

const rootDir = path.resolve(import.meta.dirname, '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

const clientDist = path.join(rootDir, 'client', 'dist');
const { app, serveClient } = createApp({
  clientDist,
  discordClientId: process.env.DISCORD_CLIENT_ID,
  discordClientSecret: process.env.DISCORD_CLIENT_SECRET,
});

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
