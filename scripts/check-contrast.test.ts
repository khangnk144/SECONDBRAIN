import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  checkContrast,
  composeTokens,
  parseAttributeSelectors,
  contrastRatio,
  PAIRS,
  parseTokenRules,
  relativeLuminance,
} from './check-contrast.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(path.join(here, '..', 'web', 'src', 'styles', 'tokens.css'), 'utf8');

describe('WCAG contrast math', () => {
  it('matches the reference values', () => {
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 10);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
    expect(contrastRatio('#fff', '#000')).toBe(contrastRatio('#000', '#fff'));
  });

  it('rejects non-hex values', () => {
    expect(() => relativeLuminance('rgb(0,0,0)')).toThrow();
  });
});

describe('token composition', () => {
  const css = `
    :root { --bg: #000000; --accent: #111111; }
    :root[data-theme="light"] { --bg: #ffffff; --accent: #222222; }
    :root[data-palette="p2"] { --accent: #333333; }
    :root[data-palette="p2"][data-theme="light"] { --accent: #444444; }
    .other { --bg: #999999; }
  `;
  const rules = parseTokenRules(css);

  it('reads attribute selectors with any quote style', () => {
    expect(parseAttributeSelectors(`:root[data-palette='p2'][data-theme="light"]`)).toEqual({
      'data-palette': 'p2',
      'data-theme': 'light',
    });
    expect(parseAttributeSelectors(':root[data-theme=light]')).toEqual({ 'data-theme': 'light' });
    expect(() => parseAttributeSelectors(':root[data-theme~="light"]')).toThrow();
  });

  it('only picks :root rules', () => {
    expect(rules).toHaveLength(4);
  });

  it('applies the cascade like the browser does', () => {
    expect(composeTokens(rules, 'dark', 'dau-tam')).toEqual({
      '--bg': '#000000',
      '--accent': '#111111',
    });
    expect(composeTokens(rules, 'light', 'dau-tam')['--accent']).toBe('#222222');
    expect(composeTokens(rules, 'dark', 'p2' as never)['--accent']).toBe('#333333');
    const lightP2 = composeTokens(rules, 'light', 'p2' as never);
    expect(lightP2).toEqual({ '--bg': '#ffffff', '--accent': '#444444' });
  });
});

describe('real design tokens', () => {
  it('define every token the checked pairs need in all six combinations', () => {
    const results = checkContrast(tokensCss);
    expect(results).toHaveLength(PAIRS.length * 6);
  });

  it('pass every contrast threshold', () => {
    const failures = checkContrast(tokensCss).filter((r) => !r.pass);
    expect(failures).toEqual([]);
  });

  it('give the light palettes their own accent (not the dark one)', () => {
    const rules = parseTokenRules(tokensCss);
    expect(composeTokens(rules, 'light', 'hoa-dao')['--accent']?.toUpperCase()).toBe('#B03858');
    expect(composeTokens(rules, 'dark', 'hoa-dao')['--accent']?.toUpperCase()).toBe('#E58AA3');
    expect(composeTokens(rules, 'light', 'oai-huong')['--on-accent']?.toUpperCase()).toBe(
      '#FFFFFF',
    );
  });
});
