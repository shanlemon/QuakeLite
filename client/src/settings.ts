import type { Settings } from './types';
import { sanitizeOptionalPlayerName } from '../../shared/playerName';
import { normalizeSensitivity } from './inputState';

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SETTINGS_KEY = 'quakelite-settings';
export const DEFAULT_SETTINGS: Settings = { playerName: '', fov: 105, sensitivity: 2, volume: 0.7 };

export function clampNumber(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function finiteSetting(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
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
    volume: clampNumber(finiteSetting(raw?.volume, DEFAULT_SETTINGS.volume), 0, 1),
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
