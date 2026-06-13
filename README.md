# QuakeLite

A multiplayer arena FPS that runs as a **Discord Activity** — Quake Live Instagib, distilled. One weapon, one-shot kills, authentic VQ3 movement, played inside a Discord voice channel. The server is authoritative (60 Hz simulation, 20 Hz snapshots); the client predicts locally so it feels instant even at high ping.

- **Real Quake movement** — faithful VQ3 physics: strafe jumping, bunny hopping, circle jumps. 320 ups on the ground, no ceiling in the air if your aim is smooth.
- **Instagib rail** — hitscan laser, infinite range, one shot one kill, 1.5 s cooldown. No items, no health, no excuses.
- **Vortex Portal** — a recreation of the Quake Live map (Team Arena's mpteam6): three platform clusters floating in open space — two mirrored bases and a neutral central platform riding anti-grav thrusters — connected only by giant swirling vortex portals. Flank portals jump you straight to the enemy base, launch pads throw you through a floating mid portal to the central platform, exits drop you in from above, and every deck edge falls away into the void.
- **Discord-native identity & matchmaking** — your Discord username and avatar are your in-game identity (verified server-side, unspoofable). Everyone in the same voice-channel activity instance lands in the same FFA match. No lobby, no name entry.

## Quick start (plain browser, no Discord)

The client ships with a mock Discord SDK, auto-detected when the page is loaded without a `frame_id` query param (i.e. outside the Discord iframe). You get a guest identity and can play immediately.

```powershell
npm install
npm run dev
```

Open <http://localhost:5173>. Click to lock the pointer and play.

- Open a **second tab with the same URL** to fight yourself — both tabs join the same room.
- Append `?instance=foo` to pick a specific room (anything sharing the same `instance` value plays together).

Run the physics, protocol, and map test suites:

```powershell
npm test
```

There is also a live end-to-end netcode test that spawns a real server and plays
a two-client match over WebSockets (join, snapshots, movement, a lag-compensated
rail kill, cooldown, respawn):

```powershell
npx tsx tests/e2e.test.ts
```

## Creating the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. On **General Information**, copy the **Application ID** — this is your client id.
3. Under **OAuth2**, copy (or reset) the **Client Secret**.
4. Still under **OAuth2**, add **any** redirect URL, e.g. `https://127.0.0.1`. The portal requires at least one; the embedded-app flow never uses it.
5. Open the **Activities** tab and **Enable Activities**.
6. Under **Activities → URL Mappings**, add one mapping:
   - **PREFIX:** `/`
   - **TARGET:** your tunnel/host domain, e.g. `your-tunnel.trycloudflare.com` — **no scheme**, just the domain.

The app only ever requests the `identify` scope — no guild or message access.

## Environment

```powershell
Copy-Item .env.example .env
```

(`cp .env.example .env` on macOS/Linux.) Then fill in:

| Variable | Value |
| --- | --- |
| `VITE_DISCORD_CLIENT_ID` | The Application ID (exposed to the client) |
| `DISCORD_CLIENT_ID` | The same Application ID (used server-side) |
| `DISCORD_CLIENT_SECRET` | The OAuth2 client secret (**server-side only — never ship to the client**) |
| `PORT` | Game server port, default `3001` |

Restart the dev servers after editing `.env` — values are read at startup.

## Running inside Discord (dev)

**Terminal A** — start the game:

```powershell
npm run dev
```

This runs both processes: the game server on `:3001` and Vite on `:5173`. Vite proxies `/api` and `/ws` through to the server, so the tunnel only needs to point at Vite.

**Terminal B** — start a Cloudflare quick tunnel (install `cloudflared` first):

```powershell
winget install Cloudflare.cloudflared   # Windows
# brew install cloudflared              # macOS

npm run tunnel
```

`cloudflared` prints an `https://<random>.trycloudflare.com` URL. Paste **the domain** (no `https://`) into the URL Mapping target in the Developer Portal.

Then, in Discord:

1. **User Settings → Advanced → Developer Mode: ON.**
2. Join a **voice channel**.
3. Open the **Activities** (rocket) launcher — your app appears there for members of the application's team.
4. Launch it. Everyone who joins the activity in that channel joins the match.

For Vite HMR to work through the tunnel, set `TUNNEL=1` before starting dev (HMR must use wss on 443 behind the proxy):

```powershell
$env:TUNNEL = '1'; npm run dev
```

```bash
TUNNEL=1 npm run dev
```

Caveats:

- The quick-tunnel URL **changes every run** — re-edit the URL Mapping each time you restart the tunnel.
- URL Mapping changes can take a minute to propagate and require fully closing and relaunching the activity.

## Production-ish

```powershell
npm run build    # builds the client into client/dist
npm start        # Express serves client/dist + the API + the game WebSocket on :3001
npm run tunnel:prod
```

`tunnel:prod` points cloudflared at `:3001` (no Vite in the loop). For a real deployment, run the server behind any stable HTTPS host and set the URL Mapping target to that domain.

## Controls

| Input | Action |
| --- | --- |
| Click | Lock pointer / start playing |
| `W A S D` | Move |
| Mouse | Look |
| Left mouse | Fire rail |
| `Space` | Jump (hold for auto-hop) |
| `Tab` | Scoreboard |
| `Esc` | Pause overlay (settings: FOV, sensitivity, volume) |

### The movement

Strafe jumping is the whole game. The 60-second tutorial:

1. Run forward and jump.
2. In the air, hold **W + D** and turn the mouse **smoothly to the right** — not a flick, a steady sweep matching your turn.
3. Just before landing, jump again (or just hold `Space` — landing-frame friction is skipped when a jump is queued, so bunny hopping carries your speed).
4. Alternate: next hop, hold **W + A** and sweep left.

Watch the speedometer on the HUD: **320** ups is plain running speed. If you see **500+**, you're doing it. Air acceleration only adds speed when your wish direction is nearly perpendicular to your velocity — that dot-product quirk of the original Quake 3 code is implemented exactly, which is why the mouse sweep matters.

## Architecture

```
/client   Vite + TypeScript + Three.js activity client (prediction, interpolation, rendering, HUD, audio)
/server   Express + ws authoritative server — 60 Hz simulation, 20 Hz snapshots, per-instance rooms
/shared   Deterministic VQ3 physics, binary protocol, map definition — imported by BOTH sides
/tests    tsx test scripts: movement, protocol, map
```

**Auth flow.** Client (inside the Discord iframe) → `discordSdk.ready()` → `commands.authorize({ scope: ['identify'], prompt: 'none', response_type: 'code' })` → `POST /.proxy/api/token` → the server exchanges the code with Discord OAuth using `DISCORD_CLIENT_SECRET` → client calls `commands.authenticate({ access_token })`. The Discord identity (username, avatar) becomes the in-game identity. On join, the game server re-verifies the access token against `discord.com/api/users/@me`, so identities cannot be spoofed.

**Discord proxy.** The activity iframe is sandboxed; all traffic goes through Discord's proxy. Every path is prefixed `/.proxy/` — fetches **and** the game WebSocket (`wss://<host>/.proxy/ws`). One URL Mapping (`/` → your tunnel/host domain) covers everything.

**Matchmaking.** `discordSdk.instanceId` is the room id. Everyone in the same voice-channel activity instance is placed in the same FFA match automatically.

**Netcode.**

- Server simulates at **60 Hz**, sends snapshots at **20 Hz** (every 3rd tick).
- **Client-side prediction + reconciliation** for the local player: inputs apply locally the same frame, then replay on top of each acked server snapshot.
- **Entity interpolation** (~100 ms buffer) for remote players.
- **Lag compensation** for rail shots: the server rewinds hitboxes to the shooter's perceived time before resolving the hitscan.
- Compact little-endian binary encoding on the hot path: input commands are **21 bytes**; snapshots are **14 + 36·n bytes** (n = players) — a full 8-player snapshot is 302 bytes, ~6 KB/s per client at 20 Hz. Everything else (joins, kills, beams, scores, pings) is JSON.

**Game rules.** Instagib rail (one shot one kill, 1.5 s cooldown), free-for-all, frag limit **20** or **10 minutes**, respawn after **2 s** at the spawn farthest from enemies, scoreboard on `Tab`, match restarts after a **10 s** intermission.

## Troubleshooting

- **Blank screen inside Discord** — the URL Mapping is wrong or points at a dead tunnel. Quick tunnels get a new domain on every restart; update the mapping and relaunch the activity (propagation can take a minute).
- **"auth failed"** — `VITE_DISCORD_CLIENT_ID` / `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` mismatch. All three must come from the *same* application; restart the dev servers after editing `.env`.
- **WebSocket connects in a browser tab but fails inside Discord** — traffic isn't going through `/.proxy/`. Verify the URL Mapping exists (`/` → your domain, no scheme) and that the activity was relaunched after changing it.
- **Avatars not loading on the scoreboard** — Discord CDN hiccup; the UI falls back to colored initials automatically. Cosmetic only.
- **Remote players look choppy** — packet loss on their connection. Interpolation hides ~100 ms of jitter; beyond that, extrapolation gaps are visible. Your own movement is predicted locally and stays smooth regardless.
- **`npm audit` reports 2 critical warnings** — known issue in transitive *dev-only* dependencies; nothing from them ships to the client or runs in the game server at runtime.
