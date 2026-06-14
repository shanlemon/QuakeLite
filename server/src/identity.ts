import { randomUUID } from 'node:crypto';
import type { ClientJsonMsg } from '../../shared/protocol';
import { verifyDiscordUser } from './discord';

export interface Identity {
  userId: string;
  name: string;
  avatar: string | null;
}

type JoinMsg = Extract<ClientJsonMsg, { type: 'join' }>;

export async function resolveJoinIdentity(msg: JoinMsg): Promise<Identity | null> {
  if (typeof msg.accessToken === 'string' && msg.accessToken.length > 0) {
    const user = await verifyDiscordUser(msg.accessToken);
    if (!user) return null;
    return { userId: user.id, name: sanitizeName(user.username), avatar: user.avatar };
  }

  return {
    userId: `guest:${randomUUID().slice(0, 8)}`,
    name: sanitizeName(msg.user?.username),
    avatar: sanitizeAvatar(msg.user?.avatar),
  };
}

function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Player';
  const cleaned = raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
  return cleaned.length > 0 ? cleaned : 'Player';
}

/** Guests can only carry an avatar that looks like a Discord avatar hash. */
function sanitizeAvatar(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-z0-9_]{4,64}$/i.test(raw) ? raw : null;
}
