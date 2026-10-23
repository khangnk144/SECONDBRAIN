import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BENTO_PAIRS,
  BENTO_SELECTED_PAIRS,
  checkContrast,
  composeTokens,
  opaqueHex,
  parseAttributeSelectors,
  contrastRatio,
  PAIRS,
  PAIRS_BY_STYLE,
  parseTokenRules,
  relativeLuminance,
  resolveColor,
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
    // The 96 calm checks of design.md §2.5 stay as they were; bento adds its own six sets.
    expect(results.filter((r) => r.style === 'calm')).toHaveLength(PAIRS.length * 6);
    expect(PAIRS.length * 6).toBe(96);
    expect(results.filter((r) => r.style === 'bento')).toHaveLength(
      PAIRS_BY_STYLE.bento.length * 6,
    );
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

describe('Bento tokens (F35.6, design.md §12.8)', () => {
  const rules = parseTokenRules(tokensCss);

  it('(F35.6) checks every §12.8 pair for 2 themes × 3 palettes under data-style="bento"', () => {
    const results = checkContrast(tokensCss).filter((r) => r.style === 'bento');
    for (const pair of BENTO_PAIRS) {
      const runs = results.filter((r) => r.fg === pair.fg && r.bg === pair.bg);
      expect(runs.map((r) => `${r.theme}/${r.palette}`).sort()).toEqual([
        'dark/dau-tam',
        'dark/hoa-dao',
        'dark/oai-huong',
        'light/dau-tam',
        'light/hoa-dao',
        'light/oai-huong',
      ]);
    }
    const pairs = BENTO_PAIRS.map((p) => `${p.fg} ${p.bg} ${p.min}`);
    expect(pairs).toEqual(
      expect.arrayContaining([
        '--ink --tile 4.5',
        '--ink-2 --tile 4.5',
        '--ink --tile-2 4.5',
        '--ink-2 --tile-2 4.5',
        '--on-tint --tint-from 4.5',
        '--on-tint --tint-to 4.5',
        '--on-accent --accent 4.5',
        '--pastel-lilac --tile 3',
        '--pastel-peach --tile 3',
        '--pastel-mint --tile 3',
        '--pastel-butter --tile 3',
        '--accent --tile 3',
      ]),
    );
    expect(results.filter((r) => !r.pass)).toEqual([]);
  });

  it('(F35.6) palettes apply on top of bento in both themes; calm is untouched', () => {
    const lightPeach = composeTokens(rules, 'light', 'hoa-dao', 'bento');
    expect(lightPeach['--accent']?.toUpperCase()).toBe('#B03858');
    expect(lightPeach['--tile']?.toUpperCase()).toBe('#FFFFFF');
    expect(lightPeach['--bg']?.toUpperCase()).toBe('#F5EFF7');
    const darkLavender = composeTokens(rules, 'dark', 'oai-huong', 'bento');
    expect(darkLavender['--accent']?.toUpperCase()).toBe('#B9A0E0');
    expect(darkLavender['--bg']?.toUpperCase()).toBe('#15101A');
    expect(darkLavender['--tint-from']?.toUpperCase()).toBe('#E9D7FF');
    const calm = composeTokens(rules, 'dark', 'dau-tam');
    expect(calm['--bg']?.toUpperCase()).toBe('#1C1622');
    expect(calm['--tile']).toBeUndefined();
    expect(composeTokens(rules, 'light', 'dau-tam')['--ink-2']?.toUpperCase()).toBe('#7A6B82');
  });

  it('reports a bento pair that fails (the check is live, thresholds are not lowered)', () => {
    const css = `${tokensCss}\n:root[data-style='bento'][data-theme='light'] { --tile: #7a6b82; }`;
    const failing = checkContrast(css).filter((r) => !r.pass);
    expect(failing.length).toBeGreaterThan(0);
    expect(failing.every((r) => r.style === 'bento' && r.theme === 'light')).toBe(true);
    expect(failing.some((r) => r.fg === '--ink-2' && r.bg === '--tile' && r.min === 4.5)).toBe(
      true,
    );
  });
});

describe('selected item on the accent wash (design.md §12.2, active rail entry)', () => {
  const rules = parseTokenRules(tokensCss);

  it('lays a color-mix wash over its background and follows var() references', () => {
    const tokens = {
      '--accent': '#ff0000',
      '--alias': 'var(--accent)',
      '--wash': 'color-mix(in srgb, var(--alias) 18%, transparent)',
      '--tile': '#ffffff',
    };
    expect(resolveColor('var(--alias)', tokens)).toEqual({ rgb: [255, 0, 0], alpha: 1 });
    const wash = resolveColor(tokens['--wash'], tokens);
    expect(wash.alpha).toBeCloseTo(0.18, 10);
    // 18 % red over white: 255, 0.82 × 255 = 209, 209.
    expect(opaqueHex(wash, resolveColor('#ffffff', tokens))).toBe('#ffd1d1');
    expect(() => opaqueHex(wash)).toThrow();
    expect(() => resolveColor('var(--nope)', tokens)).toThrow(/Missing token --nope/);
  });

  it('(F35.2) --accent-ink reaches 4.5:1 on --accent-wash over --tile in all six bento sets', () => {
    expect(PAIRS_BY_STYLE.bento).toEqual(expect.arrayContaining(BENTO_SELECTED_PAIRS));
    const runs = checkContrast(tokensCss).filter(
      (r) => r.fg === '--accent-ink' && r.bg === '--accent-wash' && r.over === '--tile',
    );
    expect(runs).toHaveLength(6);
    expect(runs.every((r) => r.style === 'bento' && r.min === 4.5 && r.pass)).toBe(true);
  });

  it('(F35.2) it is the accent itself except in light "Hoa đào", whose accent stays under 4.5:1', () => {
    for (const style of ['calm', 'bento'] as const) {
      for (const theme of ['dark', 'light'] as const) {
        for (const palette of ['dau-tam', 'hoa-dao', 'oai-huong'] as const) {
          const tokens = composeTokens(rules, theme, palette, style);
          const special = style === 'bento' && theme === 'light' && palette === 'hoa-dao';
          expect(tokens['--accent-ink']).toBe(special ? '#ac3757' : 'var(--accent)');
        }
      }
    }
    // Without its own value the light "Hoa đào" label would fail (4.49:1): the check is live.
    const css = `${tokensCss}\n:root[data-style='bento'][data-palette='hoa-dao'][data-theme='light'] { --accent-ink: var(--accent); }`;
    const failing = checkContrast(css).filter((r) => !r.pass);
    expect(failing.map((r) => `${r.style}/${r.theme}/${r.palette} ${r.fg}`)).toEqual([
      'bento/light/hoa-dao --accent-ink',
    ]);
    expect(failing[0]?.ratio).toBeCloseTo(4.49, 2);
  });
});
