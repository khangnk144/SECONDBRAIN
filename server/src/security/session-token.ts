import { randomBytes, timingSafeEqual } from 'node:crypto';

/** 32 random bytes, base64url: unguessable, safe in headers, query strings and meta tags. */
export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isWellFormedToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{32,}$/.test(value);
}

/** Constant-time comparison; a length mismatch still performs a full-length comparison. */
export function tokensMatch(expected: string, provided: string | undefined | null): boolean {
  if (typeof provided !== 'string') return false;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (providedBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(expectedBuffer, expectedBuffer);
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
