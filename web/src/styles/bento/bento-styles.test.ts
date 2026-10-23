import { beforeAll, describe, expect, it } from 'vitest';
import { readWebSource } from '../../lib/testing/read-source-file';

const FILES = [
  'bento-local-tokens.css',
  'bento-shell.css',
  'bento-rail.css',
  'bento-controls.css',
  'bento-tiles.css',
  'bento-overlays.css',
  'bento-responsive.css',
];
const SCOPE = ":root[data-style='bento']";

interface Rule {
  file: string;
  selectors: string[];
  body: string;
}

let rules: Rule[] = [];
let responsive = '';

/** Plain rules (innermost blocks, media queries included) without comments. */
function parse(file: string, css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    file,
    // Split on commas outside parentheses (`:is(a, b)` stays one selector).
    selectors: (match[1] ?? '')
      .trim()
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim().replace(/\s+/g, ' ')),
    body: match[2] ?? '',
  }));
}

const find = (needle: string) =>
  rules.filter((rule) => rule.selectors.some((selector) => selector.includes(needle)));
const declares = (rule: Rule, property: string, value: string) =>
  new RegExp(`(^|[;\\s])${property}:\\s*${value.replace(/[()]/g, '\\$&')}\\s*(;|$)`).test(
    rule.body,
  );
const anyDeclares = (needle: string, property: string, value: string) =>
  find(needle).some((rule) => declares(rule, property, value));

// jsdom has no layout: these guard the CSS contracts of F35.2–F35.7 and F28.1.
describe('bento styles', () => {
  beforeAll(async () => {
    rules = [];
    for (const file of FILES)
      rules.push(...parse(file, await readWebSource(`styles/bento/${file}`)));
    responsive = await readWebSource('styles/bento/bento-responsive.css');
  });

  it('(F35.7) every bento rule is scoped to :root[data-style="bento"], so calm is untouched', () => {
    const unscoped = rules.flatMap((rule) =>
      rule.selectors.filter((s) => !s.startsWith(SCOPE)).map((s) => `${rule.file}: ${s}`),
    );
    expect(unscoped).toEqual([]);
  });

  it('(F35.7) tiles: --tile, radius 26, the 1 px gradient border; hover only brightens it', () => {
    const tile = find('.tile,').find((rule) =>
      declares(rule, 'border-radius', 'var(--radius-tile)'),
    );
    expect(tile).toBeDefined();
    expect(tile?.body).toMatch(/border:\s*1px solid transparent/);
    expect(tile?.body).toMatch(
      /linear-gradient\(var\(--tile\), var\(--tile\)\) padding-box,\s*var\(--tile-border\) border-box/,
    );
    const hover = rules.filter((rule) => rule.selectors.some((s) => s.includes(':hover')));
    expect(hover.length).toBeGreaterThan(0);
    for (const rule of hover) expect(rule.body).not.toMatch(/transform|translate|scale|box-shadow/);
    expect(anyDeclares('.tile', 'background', 'var(--tint)')).toBe(true);
  });

  it('(F35.7) checkbox square 20 px radius 7; primary button 46/16/600', () => {
    const box = find('.deadline-check__box')[0] as Rule;
    expect(declares(box, 'width', '20px')).toBe(true);
    expect(declares(box, 'height', '20px')).toBe(true);
    expect(declares(box, 'border-radius', 'var(--radius-check)')).toBe(true);
    const primary = find('.button--primary')[0] as Rule;
    expect(declares(primary, 'min-height', 'var(--control-h)')).toBe(true);
    expect(declares(primary, 'font-weight', '600')).toBe(true);
    expect(anyDeclares(' .button', 'border-radius', 'var(--radius-control)')).toBe(true);
  });

  it('(F35.7) right-panel sections are tiles radius 20, 12 px apart', () => {
    const section = find('.right-panel .note-panel > *')[0] as Rule;
    expect(declares(section, 'border-radius', 'var(--radius-panel-tile)')).toBe(true);
    expect(anyDeclares('.right-panel .note-panel', 'gap', 'var(--gap-panel-tile)')).toBe(true);
  });

  it('(F35.2/F35.3) rail 84 px tile, labels 10.5 px, active wash; search field 46 px radius 16', () => {
    const rail = rules.find(
      (rule) => rule.file === 'bento-rail.css' && rule.selectors.includes(`${SCOPE} .rail`),
    ) as Rule;
    expect(declares(rail, 'width', 'var(--rail-w)')).toBe(true);
    expect(declares(rail, 'border-radius', 'var(--radius-tile)')).toBe(true);
    expect(declares(rail, 'overflow-y', 'auto')).toBe(true);
    expect(anyDeclares('.rail-item__label', 'font-size', 'max(10.5px, 0.65625rem)')).toBe(true);
    expect(anyDeclares('.rail-item.is-active', 'background', 'var(--accent-wash)')).toBe(true);
    // §12.2: icon and label of the current place in the accent (4.5:1 on the wash, tokens.css).
    expect(anyDeclares('.rail-item.is-active', 'color', 'var(--accent-ink)')).toBe(true);
    expect(anyDeclares('.rail-item.is-active .rail-item__icon', 'color', 'var(--accent-ink)')).toBe(
      true,
    );
    expect(find('.rail-item.is-active').some((r) => declares(r, 'color', 'var(--ink)'))).toBe(
      false,
    );
    const search = find('.top-bar__search')[0] as Rule;
    expect(declares(search, 'height', 'var(--control-h)')).toBe(true);
    expect(declares(search, 'border-radius', 'var(--radius-control)')).toBe(true);
    expect(anyDeclares('.folder-pane', 'width', 'var(--folder-pane-w)')).toBe(true);
  });

  it('(F35.5, F28.1) below 960 px the rail is a row; at 600 px a fixed bottom tab bar', () => {
    const narrow = responsive.slice(responsive.indexOf('@media (max-width: 959px)'));
    expect(narrow).toMatch(/\.rail \{[^}]*flex-direction: row/);
    expect(narrow).toMatch(/\.rail__list \{[^}]*overflow-x: auto/);
    expect(narrow).toMatch(/\.bento-column \{[^}]*flex-direction: column/);
    const phone = responsive.slice(responsive.indexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.bottom-bar \{[^}]*position: fixed/);
    expect(phone).toMatch(/env\(safe-area-inset-bottom/);
    expect(phone).toMatch(/\.bottom-bar \.rail-item \{[^}]*min-height: 56px/);
  });
});

describe('phone rules shared by both styles (F28.1)', () => {
  it('(F28.1) touch targets are at least 40 px and overlays use the full width', async () => {
    const css = await readWebSource('styles/app-layout.css');
    const phone = css.slice(css.indexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.app-shell \.icon-button \{[^}]*width: 40px;[^}]*height: 40px/);
    expect(phone).toMatch(/\.app-shell \.tree-item \{[^}]*min-height: 40px/);
    expect(phone).toMatch(/\.app-shell \.modal-backdrop \{[^}]*padding: var\(--space-3\)/);
    expect(phone).toMatch(/\.app-shell \.capture-box \{[^}]*width: 100%/);
    const overlay = await readWebSource('app/shell-overlay.css');
    expect(overlay).toMatch(/@media \(pointer: coarse\), \(max-width: 600px\)/);
  });
});
