// ---------------------------------------------------------------------------
// Discord embedded-app-sdk integration. Inside the Discord iframe (detected
// via the frame_id query param) we run the full ready → authorize → token
// exchange → authenticate flow. In a plain browser tab we skip the SDK and
// fabricate a guest identity so the game is testable without Discord.
// ---------------------------------------------------------------------------

import { Common, DiscordSDK, Platform } from '@discord/embedded-app-sdk';

export interface DiscordUser {
  id: string;
  username: string;
  avatar: string | null;
}

export interface DiscordContext {
  user: DiscordUser;
  /** Activity instance id — the matchmaking room key. */
  instanceId: string;
  /** OAuth token (real mode only) — the server verifies identity with it. */
  accessToken?: string;
  isDiscord: boolean;
  isMobile: boolean;
  /** Update rich presence with the current frag count (throttled, best-effort). */
  updateActivity(frags: number): void;
}

const ACTIVITY_THROTTLE_MS = 10_000;

export async function initDiscord(): Promise<DiscordContext> {
  const params = new URLSearchParams(location.search);
  if (!params.has('frame_id')) return initMock(params);

  const clientId = String(import.meta.env.VITE_DISCORD_CLIENT_ID ?? '');
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();

  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    state: '',
    prompt: 'none',
    // rpc.activities.write is required for setActivity rich presence — the
    // Discord client rejects SET_ACTIVITY for tokens missing it.
    scope: ['identify', 'rpc.activities.write'],
  });

  // Exchange the code through our server (which holds the client secret).
  // All iframe traffic must go through the Discord activity proxy.
  const res = await fetch('/.proxy/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed (${res.status})`);
  const { access_token } = (await res.json()) as { access_token: string };

  const auth = await sdk.commands.authenticate({ access_token });

  const isMobile = sdk.platform === Platform.MOBILE;
  if (isMobile) {
    try {
      await sdk.commands.setOrientationLockState({
        lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      });
    } catch {
      // Older mobile clients reject this — not fatal.
    }
  }

  // Rich presence, throttled to one call per 10s with a trailing update so
  // the latest frag count always lands eventually. Failures are ignored —
  // presence is cosmetic.
  let lastSentAt = 0;
  let latestFrags = 0;
  let trailing: number | undefined;
  const sendActivity = (frags: number): void => {
    lastSentAt = Date.now();
    try {
      sdk.commands
        .setActivity({
          activity: {
            type: 0,
            details: 'Fragging in Vortex Portal',
            state: `${frags} frag${frags === 1 ? '' : 's'}`,
          },
        })
        .catch(() => {});
    } catch {
      // ignore — presence is best-effort
    }
  };
  const updateActivity = (frags: number): void => {
    latestFrags = frags;
    const wait = ACTIVITY_THROTTLE_MS - (Date.now() - lastSentAt);
    if (wait <= 0) {
      sendActivity(frags);
    } else if (trailing === undefined) {
      trailing = window.setTimeout(() => {
        trailing = undefined;
        sendActivity(latestFrags);
      }, wait);
    }
  };
  updateActivity(0);

  return {
    user: {
      id: auth.user.id,
      username: auth.user.global_name ?? auth.user.username,
      avatar: auth.user.avatar ?? null,
    },
    instanceId: sdk.instanceId,
    accessToken: access_token,
    isDiscord: true,
    isMobile,
    updateActivity,
  };
}

/**
 * Plain-browser fallback: no SDK, fabricated guest identity. Two tabs opened
 * with the same ?instance= query land in the same match (handy for local
 * multiplayer testing); otherwise everyone shares 'local-dev'.
 */
function initMock(params: URLSearchParams): DiscordContext {
  const tag = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return {
    user: { id: `mock-${tag}`, username: `Player${tag}`, avatar: null },
    instanceId: params.get('instance') ?? 'local-dev',
    accessToken: undefined,
    isDiscord: false,
    isMobile: false,
    updateActivity: () => {},
  };
}
