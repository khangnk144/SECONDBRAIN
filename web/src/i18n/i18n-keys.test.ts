import { describe, expect, it } from 'vitest';
import en from './en.json';
import vi from './vi.json';

function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('translation files', () => {
  it('have the same keys in Vietnamese and English', () => {
    expect(keys(en).sort()).toEqual(keys(vi).sort());
  });
});
