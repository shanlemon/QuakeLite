import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { exchangeDiscordCode } from './discord';

export interface AppOptions {
  clientDist: string;
  discordClientId?: string;
  discordClientSecret?: string;
}

export interface AppResult {
  app: Express;
  serveClient: boolean;
}

export function createApp(options: AppOptions): AppResult {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json());

  app.post('/api/token', async (req, res) => {
    if (!options.discordClientId || !options.discordClientSecret) {
      res.status(503).json({ error: 'OAuth is not configured on this server' });
      return;
    }
    const code: unknown = (req.body as { code?: unknown } | null | undefined)?.code;
    if (typeof code !== 'string' || code.length === 0) {
      res.status(400).json({ error: 'missing code' });
      return;
    }
    const exchange = await exchangeDiscordCode({
      clientId: options.discordClientId,
      clientSecret: options.discordClientSecret,
      code,
    });
    if (!exchange.ok) {
      // Never log or forward Discord's response body; it can echo credentials.
      res.status(exchange.status).json({ error: 'token exchange failed' });
      return;
    }
    res.json({ access_token: exchange.accessToken });
  });

  const serveClient = fs.existsSync(options.clientDist);
  if (serveClient) {
    app.use(express.static(options.clientDist));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/') || req.path === '/ws') {
        next();
        return;
      }
      res.sendFile(path.join(options.clientDist, 'index.html'));
    });
  }

  return { app, serveClient };
}
