import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import { globToRegExp, matchesAnyGlob } from './lib/glob-to-regexp.js';
import { CSS_NAMED_COLORS } from './lib/css-named-colors.js';
import { findNamedColors, findRawColorMatches, isColorProperty } from './lib/raw-color-patterns.js';
import rule from './no-raw-color.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
});

tester.run('no-raw-color', rule, {
  valid: [
    'const c = "var(--accent)";',
    'const c = getComputedStyle(el).getPropertyValue("--graph-wiki");',
    'const href = "#/note/abc";',
    'const entity = "&#123;";',
    'const id = "#section-2";',
    'const a = <div style={{ color: "var(--ink)" }} />;',
    'const label = "background";',
    'const a = <div style={{ color: "currentColor", background: "transparent" }} />;',
    'const a = <Icon color="currentColor" weight="bold" />;',
    'const note = "Màu white trong câu chữ thường không sao";',
    'const a = <div className="red white-card" title={t("x")} />;',
    'const a = <div style={{ border: "1px solid var(--line)" }} />;',
    'const s = { label: "red" };',
    'const tip = "a lab (room 3) and a color (any)";',
  ],
  invalid: [
    { code: 'const c = "#D88AB6";', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "#fff";', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "#1C1622cc";', errors: [{ messageId: 'raw' }] },
    { code: 'const c = `rgb(${r}, 0, 0)`;', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "rgba(0,0,0,.4)";', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "hsl(300 50% 40%)";', errors: [{ messageId: 'raw' }] },
    { code: 'const a = <svg fill="#9E3F73" />;', errors: [{ messageId: 'raw' }] },
    { code: 'ctx.fillStyle = "#5FB89E";', errors: [{ messageId: 'raw' }] },
    { code: 'const c = "oklch(70% 0.1 300)";', errors: [{ messageId: 'raw' }] },
    {
      code: 'const c = `color-mix(in srgb, var(--a) 40%, black)`;',
      errors: [{ messageId: 'raw' }],
    },
    {
      code: 'const c = ["lab(50% 40 59)", "lch(50% 40 59)", "hwb(0 0% 0%)", "oklab(0.5 0 0)", "color(srgb 1 0 0)"];',
      errors: Array(5).fill({ messageId: 'raw' }),
    },
    {
      code: 'const a = <div style={{ color: "white" }} />;',
      errors: [{ messageId: 'raw', data: { color: 'white' } }],
    },
    {
      code: 'const s = { backgroundColor: "RebeccaPurple", borderTop: "1px solid red" };',
      errors: [{ messageId: 'raw' }, { messageId: 'raw' }],
    },
    {
      code: 'const a = <svg><path fill="black" stroke="tomato" /></svg>;',
      errors: Array(2).fill({ messageId: 'raw' }),
    },
    {
      code: 'ctx.fillStyle = "white"; el.style.outlineColor = "gold";',
      errors: Array(2).fill({ messageId: 'raw' }),
    },
    {
      code: "const s = { 'box-shadow': `0 0 4px ${on ? 'pink' : 'var(--accent)'}` };",
      errors: [{ messageId: 'raw' }],
    },
  ],
});

describe('raw color pattern helper', () => {
  it('finds every occurrence in order', () => {
    const found = findRawColorMatches('a: #fff; b: rgb(1,2,3); c: #12345678');
    expect(found.map((f) => f.match)).toEqual(['#fff', 'rgb(', '#12345678']);
  });

  it('ignores five- and seven-digit hashes and entity references', () => {
    expect(findRawColorMatches('#12345 #1234567 &#1234;')).toEqual([]);
  });
});

describe('named colors and color properties', () => {
  it('knows the full CSS named color list but not transparent/currentcolor', () => {
    expect(CSS_NAMED_COLORS.size).toBe(148);
    expect(CSS_NAMED_COLORS.has('rebeccapurple')).toBe(true);
    expect(CSS_NAMED_COLORS.has('transparent')).toBe(false);
    expect(CSS_NAMED_COLORS.has('currentcolor')).toBe(false);
  });

  it('recognises kebab-case and camelCase color properties', () => {
    for (const p of [
      'color',
      'background',
      'background-color',
      'backgroundColor',
      'borderTopColor',
      'outline',
      'fill',
      'stroke',
      'box-shadow',
      'textDecorationColor',
      'columnRuleColor',
      'caretColor',
      'accent-color',
      'fillStyle',
    ]) {
      expect(isColorProperty(p), p).toBe(true);
    }
    for (const p of [
      'label',
      'className',
      'width',
      'prefers-color-scheme',
      '--accent',
      'colorScheme',
    ]) {
      expect(isColorProperty(p), p).toBe(false);
    }
  });

  it('finds named colors in values but not inside var() or url()', () => {
    expect(findNamedColors('1px solid White').map((m) => m.match)).toEqual(['White']);
    expect(findNamedColors('var(--red) url(white.png) transparent currentColor')).toEqual([]);
    expect(findNamedColors('0 0 2px tan, 0 0 4px var(--x)').map((m) => m.match)).toEqual(['tan']);
  });

  it('matches modern color functions only when "(" follows the name', () => {
    expect(
      findRawColorMatches('oklch(1 0 0) color-mix(in srgb, red, blue)').map((f) => f.match),
    ).toEqual(['oklch(', 'color-mix(']);
    expect(findRawColorMatches('a lab (3) the color (x) --my-color(')).toEqual([]);
  });
});

describe('glob matcher', () => {
  it('handles double star, single star and brace groups', () => {
    expect(matchesAnyGlob('web/src/a/b/c.test.tsx', ['web/src/**/*.test.tsx'])).toBe(true);
    expect(matchesAnyGlob('web/src/c.test.tsx', ['web/src/**/*.test.tsx'])).toBe(true);
    expect(matchesAnyGlob('web/src/c.tsx', ['web/src/**/*.test.tsx'])).toBe(false);
    expect(matchesAnyGlob('web\\src\\x\\__tests__\\y.ts', ['web/src/**/__tests__/**'])).toBe(true);
    expect(globToRegExp('web/src/**/*.{ts,tsx}').test('web/src/app/a.tsx')).toBe(true);
    expect(globToRegExp('*.js').test('dir/a.js')).toBe(false);
  });
});
