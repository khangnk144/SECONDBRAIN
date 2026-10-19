import { randomBytes } from 'node:crypto';

/** Crockford base32 (no I, L, O, U), as in the ULID spec. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const TIME_CHARS = 10;
const RANDOM_CHARS = 16;

function encodeTime(ms: number): string {
  let out = '';
  let rest = Math.max(0, Math.floor(ms));
  for (let i = 0; i < TIME_CHARS; i += 1) {
    out = ALPHABET[rest % 32]! + out;
    rest = Math.floor(rest / 32);
  }
  return out;
}

function randomDigits(): number[] {
  return [...randomBytes(RANDOM_CHARS)].map((byte) => byte % 32);
}

/** Adds one to a base32 digit array; on overflow the caller simply gets fresh randomness. */
function increment(digits: number[]): number[] | null {
  const next = [...digits];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i]! < 31) {
      next[i] = next[i]! + 1;
      return next;
    }
    next[i] = 0;
  }
  return null;
}

/**
 * ULID generator (26 chars, time-sortable). Monotonic within one millisecond — the random part is
 * incremented — so ids created in a burst (trash entries, journal ids) still sort by creation.
 */
export function createUlidGenerator(now: () => Date = () => new Date()): () => string {
  let lastTime = -1;
  let lastRandom: number[] = [];
  return () => {
    const time = now().getTime();
    if (time <= lastTime) {
      lastRandom = increment(lastRandom) ?? randomDigits();
    } else {
      lastTime = time;
      lastRandom = randomDigits();
    }
    return encodeTime(lastTime) + lastRandom.map((d) => ALPHABET[d]).join('');
  };
}

export function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

/** Creation time (ms) encoded in a ULID's first 10 characters. */
export function ulidTime(id: string): number {
  let ms = 0;
  for (const char of id.slice(0, TIME_CHARS)) ms = ms * 32 + ALPHABET.indexOf(char);
  return ms;
}
