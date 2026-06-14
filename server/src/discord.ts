const DISCORD_API_BASE = 'https://discord.com/api';

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export type DiscordTokenExchangeResult =
  | { ok: true; accessToken: string }
  | { ok: false; status: number };

export async function exchangeDiscordCode(input: {
  clientId: string;
  clientSecret: string;
  code: string;
}): Promise<DiscordTokenExchangeResult> {
  try {
    const response = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: input.clientId,
        client_secret: input.clientSecret,
        grant_type: 'authorization_code',
        code: input.code,
      }),
    });
    if (!response.ok) {
      return { ok: false, status: response.status >= 400 && response.status < 500 ? response.status : 400 };
    }
    const data = (await response.json()) as { access_token?: unknown };
    return typeof data.access_token === 'string'
      ? { ok: true, accessToken: data.access_token }
      : { ok: false, status: 400 };
  } catch {
    return { ok: false, status: 400 };
  }
}

/** GET /users/@me with the player's OAuth token. Null on any failure. */
export async function verifyDiscordUser(accessToken: string): Promise<DiscordUser | null> {
  try {
    const res = await fetch(`${DISCORD_API_BASE}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const u = (await res.json()) as {
      id?: unknown;
      username?: unknown;
      global_name?: unknown;
      avatar?: unknown;
    };
    if (typeof u.id !== 'string' || u.id.length === 0) return null;
    const username =
      typeof u.global_name === 'string' && u.global_name.length > 0
        ? u.global_name
        : typeof u.username === 'string'
          ? u.username
          : 'Player';
    return { id: u.id, username, avatar: typeof u.avatar === 'string' ? u.avatar : null };
  } catch {
    return null;
  }
}
