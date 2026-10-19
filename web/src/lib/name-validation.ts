/**
 * Client-side checks for note and folder names, mirroring the server's path guard so the user
 * gets a friendly message before any request. Returns an i18n key (under `operations.invalid`)
 * or null when the name is fine. Callers trim the name first (`cleanName`).
 */
export type NameProblem =
  'empty' | 'characters' | 'reserved' | 'trailingDot' | 'tooLong' | 'dotStart';

const FORBIDDEN_CHARS = /[\\/:*?"<>|]/;
// Control characters are as invalid as the punctuation above on Windows.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i;
/** File names are limited to 255 UTF-16 units on Windows; leave room for ` 2.md` suffixes. */
export const MAX_NAME_LENGTH = 200;

/** Removes surrounding whitespace (typed by accident) and normalizes to NFC. */
export function cleanName(name: string): string {
  return name.trim().normalize('NFC');
}

export function validateName(name: string): NameProblem | null {
  if (name === '') return 'empty';
  if (FORBIDDEN_CHARS.test(name) || CONTROL_CHARS.test(name)) return 'characters';
  if (name.startsWith('.')) return 'dotStart';
  // Windows reserves device names with any extension too (`CON.md`).
  const stem = name.split('.')[0] ?? name;
  if (RESERVED.test(stem.trimEnd())) return 'reserved';
  if (/[. ]$/.test(name)) return 'trailingDot';
  if (name.length > MAX_NAME_LENGTH) return 'tooLong';
  return null;
}
