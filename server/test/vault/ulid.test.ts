import { describe, expect, it } from 'vitest';
import { createUlidGenerator, isUlid } from '../../src/vault/ulid.js';

describe('ULID generator for trash and journal ids', () => {
  it('produces 26 Crockford base32 characters with the time first', () => {
    const id = createUlidGenerator(() => new Date(0))();
    expect(isUlid(id)).toBe(true);
    expect(id.slice(0, 10)).toBe('0000000000');
    expect(isUlid('01J000000000000000000000IL')).toBe(false);
    expect(isUlid('../x')).toBe(false);
  });

  it('sorts by creation even within one millisecond and when the clock steps back', () => {
    let ms = 1_760_000_000_000;
    const next = createUlidGenerator(() => new Date(ms));
    const ids = [next(), next(), next()];
    ms -= 5;
    ids.push(next());
    ms += 10;
    ids.push(next());
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
