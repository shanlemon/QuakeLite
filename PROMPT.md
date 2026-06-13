# QuakeLite — Build Prompt (Discord Activity)

Build **QuakeLite**, a multiplayer arena FPS that runs as a **Discord Activity** (embedded app inside a Discord voice channel), inspired by Quake Live's Instagib mode. Free-for-all only, one weapon, one-shot kills, and authentic Quake-style movement. Recreate the Quake Live map **Vortex Portal** as the playable arena.

## Platform — Discord Activity
This is an embedded web app running in an iframe inside the Discord client, built with the **`@discord/embedded-app-sdk`** (npm). Follow the official Discord Activity architecture:

- **Project layout:** a Vite-based `/client` (Three.js game) and a Node.js `/server` (Express + `ws`) in one repo. The server serves three things: the built client, a small OAuth API, and the authoritative game WebSocket.
- **SDK bootstrap (client):**
  1. `new DiscordSDK(VITE_DISCORD_CLIENT_ID)` and `await discordSdk.ready()`.
  2. `discordSdk.commands.authorize({ response_type: 'code', prompt: 'none', scope: ['identify'] })` to get an OAuth code.
  3. POST the code to `/.proxy/api/token`; the server exchanges it (using `DISCORD_CLIENT_SECRET`) with Discord's OAuth token endpoint and returns `access_token`.
  4. `discordSdk.commands.authenticate({ access_token })` — now you have the player's Discord **username, id, and avatar**. Use these as the in-game identity (no name-entry screen).
- **Networking through the Discord proxy:** the iframe is sandboxed — ALL requests must go through Discord's activity proxy. Either prefix paths with `/.proxy/` or call `patchUrlMappings()` after `ready()`. This applies to the **game WebSocket too** (`patchWebSocket: true`, or connect to `wss://<host>/.proxy/ws`). Document the required **URL Mapping** (e.g. `/` → your tunnel/host) to set in the Discord Developer Portal under the app's Activities → URL Mappings.
- **Matchmaking = activity instance:** use `discordSdk.instanceId` as the room ID. When the client opens the game WebSocket, it sends `instanceId` + its authenticated user info; the server puts everyone with the same `instanceId` into the same FFA match. One voice channel = one match. No lobby UI needed — joining the activity joins the match.
- Subscribe to `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` to know who's in the session; use `setActivity` to show rich presence ("Fragging in Vortex Portal — 12 frags").
- **Local dev:** use a **cloudflared tunnel** (`cloudflared tunnel --url http://localhost:3001`) pointed at the dev server, with the tunnel URL set as the Developer Portal URL Mapping. Use a `.env` /`.env.example` with `VITE_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`. Include a `DiscordSDKMock` fallback (detect missing `frame_id` query param) so the game is also testable in a plain browser tab outside Discord.
- Target **desktop Discord** first. On mobile, lock landscape orientation (`setOrientationLockState`) and show a "best played on desktop" notice — touch controls are out of scope for v1.
- Render at the iframe's size and handle resize; keep load fast (no huge assets — procedural geometry/materials, synthesized sounds).

## Tech stack
- **Client:** Three.js (WebGL), TypeScript, Vite, pointer-lock mouse look (request pointer lock on click; Esc shows a pause overlay).
- **Server:** Node.js, Express + `ws`. The server is authoritative: it runs the physics simulation at a fixed 60 Hz tick per instance and owns all hit detection, deaths, and scoring.
- **Netcode:**
  - Client-side prediction for the local player (inputs applied locally immediately, reconciled against authoritative server snapshots).
  - Entity interpolation (~100 ms buffer) for remote players.
  - Lag compensation for hitscan shots: the server rewinds player hitboxes to the shooter's perceived time before resolving the shot.
  - Compact input commands (forward/right/jump/fire + view angles + sequence number) client→server; world snapshots server→clients at 20–30 Hz, per instance.
- Shared movement/physics module used by both client and server so prediction matches the simulation exactly.

## Movement — replicate Quake Live (VQ3) physics
Implement the classic Quake 3 movement code faithfully. Use Quake units (player is a 32×32×56 unit AABB, eye height 48):

- **Ground speed:** 320 ups max, ground acceleration 10, ground friction 6.
- **Air movement:** air acceleration 1.0 with the classic Quake air-accelerate dot-product formula — this is what makes **strafe jumping** work. Holding forward + strafe and smoothly turning the mouse mid-air must let players accelerate beyond 320 ups.
- **Bunny hopping:** jumping the frame you land carries speed (friction is not applied on the landing frame if a jump is queued). Support held-jump auto-hop.
- **Jump velocity:** 270 ups vertical. **Gravity:** 800 ups².
- **Circle jumps** off the spawn should naturally work as a consequence of correct accelerate math.
- Step-up height of 18 units for stairs/ledges; standard slide-along-wall collision response (clip velocity against planes, never get stuck).
- Show an optional speedometer (ups) on the HUD so players can verify strafe jumping works.

## Weapon — Instagib laser
- Every player has exactly one weapon: a **laser railgun**. No pickups, no ammo, no health/armor items anywhere on the map.
- **Hitscan**, infinite range, **one shot = one kill**.
- **1.5 second cooldown** between shots, with a visible recharge indicator on the HUD.
- Visual: a bright, thin laser beam (player-colored) that persists for ~300 ms then fades, with a small impact flash. Crisp firing sound and a distinct frag-confirmation sound.
- Killed players gib/explode into particles, then respawn after 2 seconds at the spawn point farthest from enemies.

## Game mode — Free-for-all
- Everyone vs. everyone within the activity instance. **Frag limit 20** or **10-minute time limit**, whichever comes first.
- Scoreboard on Tab: Discord username + avatar, frags, deaths, ping.
- Kill feed in the corner ("PlayerA ⚡ PlayerB").
- On match end: final standings overlay, 10-second intermission, then restart fresh.
- Players joining mid-match spawn in immediately. Each player gets a distinct color (beam + body tint). Support at least 8 concurrent players per instance.

## Map — recreate Vortex Portal (Quake Live)
Recreate the layout and feel of Quake Live's **Vortex Portal**, adapted for FFA. It's a symmetrical two-base map whose signature feature is a pair of large swirling **vortex portals** that instantly teleport players between the two halves of the map:

- **Two mirrored bases** (red-themed and blue-themed lighting/trim to keep orientation readable, even though this is FFA), each with a large open main hall, an upper platform/ledge overlooking the floor, and side rooms.
- **Central portal chamber(s):** the two bases are linked by giant circular **vortex portals** — animated, swirling, glowing discs (shader or animated texture). Stepping into a portal instantly teleports the player to the corresponding portal on the other side, **preserving velocity** and reorienting the view to the destination portal's facing. Teleport sound + brief screen flash.
- **Side connectors:** two flanking corridors/halls also connect the bases the "long way," so players can rotate without teleporting.
- **Jump pads** in each base that launch players up to the upper ledges (fixed launch velocity that lands the player on the platform; whoosh sound + pad glow).
- **Verticality:** upper walkways around each main hall, reachable by jump pads, stairs, and strafe jumps. No void/death pits.
- Long sightlines through the bases and portals (it's a rail map — sightlines are the gameplay), broken up by pillars and trim for cover.
- Scale generously: main halls roughly 1024×768 units with 256+ unit ceilings.
- ~8 spawn points spread across both bases and connectors.
- Style: Quake-ish gothic/tech — dark stone and metal materials with trim, moody lighting, strong colored accents around portals and jump pads. Procedural/flat materials are fine; clean geometry + good lighting beats detailed assets (and keeps the activity loading fast).

## HUD & feel
- Crosshair (small dot/cross), frag counter, cooldown indicator, speedometer, ping.
- FOV 105 by default, adjustable; mouse sensitivity setting. No mouse smoothing or acceleration.
- Footsteps, jump grunts, rail fire, portal whoosh, jump pad boing — punchy synthesized retro sounds (no large audio files).
- Fast and crisp: 60+ fps, instant input response.

## Deliverables
- `/client` — Vite + TypeScript + Three.js activity client.
- `/server` — Express + ws server: serves the built client, `/api/token` OAuth exchange, per-instance game rooms.
- `/shared` — movement/physics module used by both.
- `.env.example` with `VITE_DISCORD_CLIENT_ID`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`.
- `README.md` covering: creating the Discord application (enable Activities, set URL Mappings, OAuth2 settings, scopes), installing and running locally with a cloudflared tunnel, testing in a browser tab via the SDK mock, and launching the activity from a voice channel.

Build it step by step: (1) movement + map playable in a plain browser tab with the SDK mock — get strafe jumping right before anything else; (2) the laser and FFA rules; (3) multiplayer sync with per-instance rooms; (4) Discord SDK auth + proxy integration; (5) polish.
