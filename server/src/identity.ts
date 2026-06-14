import { randomUUID } from 'node:crypto';
import { sanitizePlayerName } from '../../shared/playerName';
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
    return {
      userId: user.id,
      name: sanitizePlayerName(msg.displayName, sanitizePlayerName(user.username)),
      avatar: user.avatar,
    };
  }

  return {
    userId: `guest:${randomUUID().slice(0, 8)}`,
    name: sanitizePlayerName(msg.displayName, sanitizePlayerName(msg.user?.username)),
    avatar: sanitizeAvatar(msg.user?.avatar),
  };
}

/** Guests can only carry an avatar that looks like a Discord avatar hash. */
function sanitizeAvatar(raw: unknown): string | null {
  return typeof raw === 'string' && /^[a-z0-9_]{4,64}$/i.test(raw) ? raw : null;
}
