// The e2e home seeding (web/e2e/helpers/e2e-style.ts) runs in Node before a server starts; it is
// tested here because the Playwright specs need a built app.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runStyle, seedStyle } from '../web/e2e/helpers/e2e-style.js';

describe('e2e homes start in the calm layout unless a spec asks for bento (F35.1)', () => {
  let home: string;
  const file = () => path.join(home, '.secondbrain', 'settings.json');
  const stored = () => JSON.parse(readFileSync(file(), 'utf8'));
  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'sb e2e Đồ án '));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('(F35.1) a fresh home gets calm; an explicit bento wins', () => {
    seedStyle(home);
    expect(stored()).toEqual({ ui: { style: 'calm' } });
    seedStyle(home, 'bento');
    expect(stored().ui.style).toBe('bento');
  });

  it('keeps what the file has: other keys, and a stored style on restart', () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(file(), JSON.stringify({ port: 47696, ui: { name: 'Nhi' } }));
    seedStyle(home);
    expect(stored()).toEqual({ port: 47696, ui: { name: 'Nhi', style: 'calm' } });
    writeFileSync(file(), JSON.stringify({ ui: { style: 'bento' } }));
    seedStyle(home);
    expect(stored().ui.style).toBe('bento');
  });

  it('SB_E2E_STYLE=bento makes bento the default of a whole run', () => {
    expect(runStyle({ SB_E2E_STYLE: 'bento' })).toBe('bento');
    expect(runStyle({})).toBe('calm');
    expect(runStyle({ SB_E2E_STYLE: 'neon' })).toBe('calm');
  });
});
