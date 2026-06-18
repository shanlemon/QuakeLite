import type { CrosshairStyle, Settings } from './types';
import { sanitizeOptionalPlayerName } from '../../shared/playerName';
import { normalizeSensitivity } from './inputState';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'quakelite-settings';
export const CROSSHAIR_SIZE_MIN = 2;
export const CROSSHAIR_SIZE_MAX = 24;
export const CROSSHAIR_GAP_MIN = 0;
export const CROSSHAIR_GAP_MAX = 18;
export const CROSSHAIR_OPACITY_MIN = 0.15;
export const CROSSHAIR_OPACITY_MAX = 1;

export const DEFAULT_SETTINGS: Settings = {
  playerName: '',
  fov: 105,
  sensitivity: 2,
  renderScale: 1,
  volume: 0.7,
  crosshairStyle: 'cross',
  crosshairColor: '#ffffff',
  crosshairSize: 4,
  crosshairGap: 5,
  crosshairOpacity: 1,
};

export function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function finiteSetting(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function crosshairStyleSetting(v: unknown): CrosshairStyle {
  return v === 'cross' || v === 'dot' || v === 'ring' ? v : DEFAULT_SETTINGS.crosshairStyle;
}

function crosshairColorSetting(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : DEFAULT_SETTINGS.crosshairColor;
}

function storageOrNull(): SettingsStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  return {
    playerName: sanitizeOptionalPlayerName(raw?.playerName),
    fov: clampNumber(finiteSetting(raw?.fov, DEFAULT_SETTINGS.fov), 90, 130),
    sensitivity: normalizeSensitivity(finiteSetting(raw?.sensitivity, DEFAULT_SETTINGS.sensitivity)),
    renderScale: clampNumber(finiteSetting(raw?.renderScale, DEFAULT_SETTINGS.renderScale), 0.5, 1),
    volume: clampNumber(finiteSetting(raw?.volume, DEFAULT_SETTINGS.volume), 0, 1),
    crosshairStyle: crosshairStyleSetting(raw?.crosshairStyle),
    crosshairColor: crosshairColorSetting(raw?.crosshairColor),
    crosshairSize: clampNumber(finiteSetting(raw?.crosshairSize, DEFAULT_SETTINGS.crosshairSize), CROSSHAIR_SIZE_MIN, CROSSHAIR_SIZE_MAX),
    crosshairGap: clampNumber(finiteSetting(raw?.crosshairGap, DEFAULT_SETTINGS.crosshairGap), CROSSHAIR_GAP_MIN, CROSSHAIR_GAP_MAX),
    crosshairOpacity: clampNumber(
      finiteSetting(raw?.crosshairOpacity, DEFAULT_SETTINGS.crosshairOpacity),
      CROSSHAIR_OPACITY_MIN,
      CROSSHAIR_OPACITY_MAX,
    ),
  };
}

export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSettings(parsed && typeof parsed === 'object' ? (parsed as Partial<Settings>) : null);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function loadSettings(storage: SettingsStorage | null = storageOrNull()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS };
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings, storage: SettingsStorage | null = storageOrNull()): void {
  if (!storage) return;
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch {
    // Storage can be unavailable in sandboxed iframes; settings still apply for the session.
  }
}
