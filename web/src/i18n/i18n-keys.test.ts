import { describe, expect, it } from 'vitest';
import { resources } from './index';

function keys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
    keys(v, prefix ? `${prefix}.${k}` : k),
  );
}

describe('translation files', () => {
  it('have the same keys in Vietnamese and English (core and feature areas merged)', () => {
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources.vi.translation).sort());
  });
});
