// ---------------------------------------------------------------------------
// Cross-module contracts for the client. game/main (core) drives a Renderer,
// a Hud and an AudioSys through these interfaces. Implementations:
//   createRenderer  → src/render/scene.ts
//   createHud       → src/hud.ts
//   createAudio     → src/audio.ts
// Keep these signatures stable — multiple modules are built against them.
// ---------------------------------------------------------------------------

import type { Vec3 } from '../../shared/math';
import type { MapDef } from '../../shared/mapdef';

/** Camera state for a frame. `pos` is the EYE position (feet + EYE_HEIGHT). */
export interface ViewState {
  pos: Vec3;
  yaw: number;
  pitch: number;
  /** Vertical-ish FOV in degrees (default 105 — applied as horizontal-feel). */
  fov: number;
}

/** What the renderer needs to draw one player this frame. */
export interface RenderPlayer {
  id: number;
  /** Feet position (already interpolated/predicted by the caller). */
  pos: Vec3;
  yaw: number;
  pitch: number;
  colorIdx: number;
  alive: boolean;
  name: string;
  /** Local player's body is not drawn (first person), but viewmodel is. */
  isLocal: boolean;
}

export interface Renderer {
  /** Re-fit to the iframe size. Call on window resize. */
  resize(): void;
  /**
   * Draw one frame. `timeMs` is a monotonic clock (performance.now()) used
   * for shader animation (portal swirl, pad pulse, beam fade).
   */
  render(dt: number, view: ViewState, players: RenderPlayer[], timeMs: number): void;
  /** Laser beam from→to in world units, tinted by player color. Fades ~300ms. */
  spawnBeam(from: Vec3, to: Vec3, colorIdx: number): void;
  /** Small impact flash where a beam hit world geometry. */
  spawnImpact(pos: Vec3, colorIdx: number): void;
  /** Gib burst where a player died. */
  spawnGibs(pos: Vec3, colorIdx: number): void;
  /** Kick the first-person viewmodel (local player fired). */
  triggerRecoil(): void;
}

/** Factory implemented by src/render/scene.ts. Appends a canvas to `container`. */
export type CreateRenderer = (map: MapDef, container: HTMLElement) => Renderer;

// ---------------------------------------------------------------------------

export interface ScoreRow {
  id: number;
  name: string;
  /** Full avatar image URL or null → render colored-initial fallback. */
  avatarUrl: string | null;
  colorIdx: number;
  frags: number;
  deaths: number;
  ping: number;
  isLocal: boolean;
}

export interface HudStats {
  frags: number;
  /** Best enemy frag count (for "place" feel); -1 if alone. */
  topEnemyFrags: number;
  /** 0..1, 1 = ready to fire. */
  cooldownFrac: number;
  /** Horizontal speed in ups. */
  speed: number;
  ping: number;
  /** Remaining match (or intermission) time in ms. */
  timeLeftMs: number;
  alive: boolean;
  /** ms until respawn when dead, else 0. */
  respawnInMs: number;
}

export interface Settings {
  /** Empty string means use the generated/Discord default. */
  playerName: string;
  fov: number; // 90..130, default 105
  sensitivity: number; // 0.05..20, default 2 (arbitrary scale; 2 ≈ q3 sens 2.5-ish)
  volume: number; // 0..1
}

export interface HudCallbacks {
  /** Pause overlay "resume" clicked → core should re-request pointer lock. */
  onResume(): void;
  onSettingsChange(s: Settings): void;
}

export interface Hud {
  /** Per-frame stats refresh. */
  setStats(s: HudStats): void;
  addKill(
    killerName: string,
    killerColorIdx: number,
    victimName: string,
    victimColorIdx: number,
    localInvolved: boolean,
  ): void;
  /** Big center message ("You fragged X", "FIGHT!"), auto-fades. */
  showMessage(text: string, ms: number): void;
  setScoreboardVisible(v: boolean): void;
  updateScoreboard(rows: ScoreRow[]): void;
  /** Full-screen tint flash (teleport = white/blue, death = red). */
  flash(cssColor: string, durationMs: number): void;
  /** Pause overlay (pointer unlocked). Contains settings + how-to-play. */
  setPauseVisible(v: boolean): void;
  /** Match-end standings overlay with restart countdown. */
  showMatchEnd(standings: { name: string; colorIdx: number; frags: number; deaths: number }[], restartInMs: number): void;
  hideMatchEnd(): void;
  /** Connection/loading screen ('' hides it). */
  setConnectionMessage(text: string): void;
  getSettings(): Settings;
}

/** Factory implemented by src/hud.ts. Owns the #hud element + its CSS. */
export type CreateHud = (root: HTMLElement, cb: HudCallbacks) => Hud;

// ---------------------------------------------------------------------------

export type SoundName =
  | 'fire' // rail shot
  | 'frag' // you killed someone (UI ding)
  | 'death' // a player gibbed (positional)
  | 'jump'
  | 'land'
  | 'footstep'
  | 'pad' // jump pad boing
  | 'teleport' // portal whoosh
  | 'respawn'
  | 'matchEnd';

export interface AudioSys {
  /** Call on first user gesture (pointer lock click) — resumes the context. */
  resume(): void;
  /** Update the 3D listener each frame. */
  setListener(pos: Vec3, yaw: number): void;
  /** Play a sound; with `pos` it is spatialized, without it plays 2D/UI. */
  play(name: SoundName, opts?: { pos?: Vec3; volume?: number }): void;
  setMasterVolume(v: number): void;
}

/** Factory implemented by src/audio.ts. */
export type CreateAudio = () => AudioSys;
