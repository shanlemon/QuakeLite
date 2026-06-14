export const MAX_PLAYER_NAME_LENGTH = 24;

function cleanedName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
}

export function sanitizePlayerName(raw: unknown, fallback = 'Player'): string {
  const cleaned = cleanedName(raw);
  return cleaned.length > 0 ? cleaned : fallback;
}

export function sanitizeOptionalPlayerName(raw: unknown): string {
  return cleanedName(raw);
}
