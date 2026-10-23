// CSS contracts of the review-B fixes (jsdom has no layout; the e2e specs check the rendered look:
// bento-shell, responsive, weekly-review). Each test names its finding.
import { beforeAll, describe, expect, it } from 'vitest';
import { readWebSource } from '../../lib/testing/read-source-file';

interface Rule {
  selectors: string[];
  body: string;
}

/** Innermost rules of `css` (media queries included), comments removed. */
function parse(css: string): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selectors: (match[1] ?? '')
      .trim()
      .split(/,(?![^(]*\))/)
      .map((part) => part.trim().replace(/\s+/g, ' ')),
    body: match[2] ?? '',
  }));
}

const files: Record<string, Rule[]> = {};
const SOURCES = [
  'styles/bento/bento-controls.css',
  'styles/bento/bento-local-tokens.css',
  'styles/bento/bento-tiles.css',
  'styles/bento/bento-rail.css',
  'styles/bento/bento-responsive.css',
  'styles/sidebar.css',
  'features/review/review-screen.css',
  'features/review/weekly-review.css',
  'features/today/bento/today-bento-widgets.css',
  'features/today/today-strip-bento.css',
  'features/graph/graph.css',
];

function rule(file: string, selector: string): Rule {
  const found = files[file]?.find((r) => r.selectors.includes(selector));
  if (!found) throw new Error(`${file}: no rule for ${selector}`);
  return found;
}
const has = (r: Rule, property: string, value: string) =>
  new RegExp(`(^|[;\\s])${property}:\\s*${value.replace(/[()[\]]/g, '\\$&')}\\s*(;|$)`).test(
    r.body,
  );

const B = ":root[data-style='bento']";

describe('review B fixes, CSS contracts', () => {
  beforeAll(async () => {
    for (const file of SOURCES) files[file] = parse(await readWebSource(file));
  });

  it('(B1) a secondary button takes the other surface of the box it sits in', () => {
    expect(has(rule(SOURCES[1]!, B), '--button-2-border', 'transparent')).toBe(true);
    expect(
      has(rule(SOURCES[0]!, `${B} .button--secondary`), 'border-color', 'var(--button-2-border)'),
    ).toBe(true);
    const inner = rule(SOURCES[2]!, `${B} .tile-inner`);
    expect(has(inner, '--button-2-bg', 'var(--tile)')).toBe(true);
    expect(has(inner, '--button-2-border', 'var(--line)')).toBe(true);
    expect(has(rule(SOURCES[2]!, `${B} .reminders-hint`), '--button-2-bg', 'var(--tile-2)')).toBe(
      true,
    );
    expect(
      has(
        rule(SOURCES[6]!, `${B} .review-screen .weekly-review__group`),
        '--button-2-bg',
        'var(--tile-2)',
      ),
    ).toBe(true);
    const sunday = rule(SOURCES[7]!, `${B} .weekly-review--tile .weekly-review__group`);
    expect(has(sunday, '--button-2-bg', 'var(--tile)')).toBe(true);
    expect(has(sunday, '--button-2-border', 'var(--line)')).toBe(true);
    expect(has(rule(SOURCES[8]!, '.today-project-offer'), '--button-2-bg', 'var(--tile)')).toBe(
      true,
    );
  });

  it('(B2) every other checkbox is the 20 px square with radius 7, drawn on the real input', () => {
    const base = `${B} input[type='checkbox']:not(.deadline-check__input, .task-item__checkbox)`;
    const box = rule(SOURCES[0]!, base);
    for (const [property, value] of [
      ['appearance', 'none'],
      ['width', '20px'],
      ['height', '20px'],
      ['border-radius', 'var(--radius-check)'],
      ['border', '1.5px solid var(--ink-2)'],
    ]) {
      expect(has(box, property!, value!), `${property}: ${value}`).toBe(true);
    }
    expect(has(rule(SOURCES[0]!, `${base}:checked`), 'background', 'var(--accent)')).toBe(true);
    expect(
      has(rule(SOURCES[0]!, `${base}:focus-visible`), 'outline', '2px solid var(--focus)'),
    ).toBe(true);
  });

  it('(B7) Settings sub-groups are inner boxes without hairlines', () => {
    const outer = rule(SOURCES[2]!, `${B} .settings-subsection`);
    expect(has(outer, 'background', 'var(--tile-2)')).toBe(true);
    expect(has(outer, 'border', '0')).toBe(true);
    expect(has(outer, 'border-radius', 'var(--radius-inner)')).toBe(true);
    const nested = rule(SOURCES[2]!, `${B} .settings-subsection .settings-subsection`);
    expect(has(nested, 'background', 'var(--tile)')).toBe(true);
    expect(has(nested, '--button-2-bg', 'var(--tile-2)')).toBe(true);
  });

  it('(B8) the rail row keeps "Thư mục" and "Cài đặt" out of the scrolling list and fades a hidden edge', () => {
    const bottom = rule(SOURCES[4]!, `${B} .rail__list.rail__list--bottom`);
    expect(has(bottom, 'flex', 'none')).toBe(true);
    expect(has(bottom, 'overflow', 'visible')).toBe(true);
    const places = files[SOURCES[4]!]!.filter((r) => r.selectors.includes(`${B} .rail__list`));
    expect(places.some((r) => has(r, 'width', 'auto') && has(r, 'overflow-x', 'auto'))).toBe(true);
    expect(
      files[SOURCES[4]!]!.some((r) =>
        r.selectors.includes(`${B} .rail__list[data-more-end='true']`),
      ),
    ).toBe(true);
    expect(has(rule(SOURCES[3]!, `${B} .rail__list.rail__list--bottom`), 'flex', 'none')).toBe(
      true,
    );
  });

  it('(B9) the calm phone drawer gives the folder tree its full height', () => {
    const tree = rule(SOURCES[5]!, '.shell-overlay__body .sidebar-folders');
    expect(has(tree, 'display', 'flex')).toBe(true);
    expect(has(tree, 'flex', 'none')).toBe(true);
    expect(has(rule(SOURCES[5]!, '.shell-overlay__body > .sidebar'), 'flex', 'none')).toBe(true);
  });

  it('(B6) on phones the brain map overlays leave the canvas, which keeps a fixed height', () => {
    const graph = files[SOURCES[10]!]!;
    const stacked = graph.find((r) =>
      r.selectors.includes(
        '.graph-screen__stage :is(.graph-screen__title, .graph-filters, .graph-screen__bottom)',
      ),
    );
    expect(stacked && has(stacked, 'position', 'static')).toBe(true);
    expect(
      has(
        rule(SOURCES[10]!, '.graph-screen__stage .graph-screen__canvas'),
        'height',
        'max(300px, 55vh)',
      ),
    ).toBe(true);
  });

  it('(B3, D1) Bento strip cells never go below 66 px and never cut the day number', () => {
    const strip = rule(SOURCES[9]!, '.today-strip--bento');
    expect(has(strip, '--today-strip-min-cell', 'max(66px, 4.125rem)')).toBe(true);
    expect(rule(SOURCES[9]!, '.today-strip--bento .today-strip__cell').body).toMatch(
      /width: max\(\s*var\(--today-strip-min-cell\)/,
    );
    const day = rule(SOURCES[9]!, '.today-strip--bento .today-strip__day');
    expect(has(day, 'text-overflow', 'clip')).toBe(true);
  });
});
