// Client settings tests - run with: npx tsx tests/settings.test.ts

import {
  DEFAULT_SETTINGS,
  SETTINGS_KEY,
  loadSettings,
  normalizeSettings,
  parseSettings,
  saveSettings,
  type SettingsStorage,
} from '../client/src/settings';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok    ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

class MemoryStorage implements SettingsStorage {
  values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

console.log('client settings');

{
  check('normalizeSettings returns defaults for empty input', JSON.stringify(normalizeSettings(null)) === JSON.stringify(DEFAULT_SETTINGS));
  const s = normalizeSettings({ fov: 100, sensitivity: 3.5, volume: 0.25 });
  check('normalizeSettings preserves valid values', s.fov === 100 && s.sensitivity === 3.5 && s.volume === 0.25);
}

{
  const s = normalizeSettings({ fov: 1000, sensitivity: -10, volume: 4 });
  check('normalizeSettings clamps out-of-range values', s.fov === 130 && s.sensitivity === 0.5 && s.volume === 1);
}

{
  const s = parseSettings(JSON.stringify({ fov: Number.NaN, sensitivity: 'fast', volume: null }));
  check('parseSettings falls back for non-finite or wrong-typed fields', JSON.stringify(s) === JSON.stringify(DEFAULT_SETTINGS));
  check('parseSettings returns defaults for malformed JSON', JSON.stringify(parseSettings('{bad')) === JSON.stringify(DEFAULT_SETTINGS));
}

{
  const storage = new MemoryStorage();
  storage.setItem(SETTINGS_KEY, JSON.stringify({ fov: 90, sensitivity: 6, volume: 0 }));
  const s = loadSettings(storage);
  check('loadSettings reads from injected storage', s.fov === 90 && s.sensitivity === 6 && s.volume === 0);
  check('loadSettings returns defaults without storage', JSON.stringify(loadSettings(null)) === JSON.stringify(DEFAULT_SETTINGS));
}

{
  const storage = new MemoryStorage();
  saveSettings({ fov: 140, sensitivity: 0, volume: -1 }, storage);
  const saved = JSON.parse(storage.getItem(SETTINGS_KEY) ?? '{}') as Record<string, number>;
  check('saveSettings stores normalized settings', saved.fov === 130 && saved.sensitivity === 0.5 && saved.volume === 0);
}

{
  const throwingStorage: SettingsStorage = {
    getItem() {
      throw new Error('nope');
    },
    setItem() {
      throw new Error('nope');
    },
  };
  check('loadSettings swallows storage read failures', JSON.stringify(loadSettings(throwingStorage)) === JSON.stringify(DEFAULT_SETTINGS));
  saveSettings(DEFAULT_SETTINGS, throwingStorage);
  check('saveSettings swallows storage write failures', true);
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall settings tests passed');
if (failures) process.exit(1);
