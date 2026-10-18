/**
 * Contrast check for the design tokens (design.md §2.5).
 * Parses web/src/styles/tokens.css, composes every theme × palette combination the
 * way the CSS cascade would, and verifies each listed pair. Exit code 1 on failure.
 * Fix failing token values in tokens.css; never lower the thresholds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type Theme = 'dark' | 'light';
export type Palette = 'dau-tam' | 'hoa-dao' | 'oai-huong';
export const THEMES: Theme[] = ['dark', 'light'];
export const PALETTES: Palette[] = ['dau-tam', 'hoa-dao', 'oai-huong'];

export interface TokenRule {
  attrs: Record<string, string>; // e.g. { 'data-theme': 'light' }
  vars: Record<string, string>; // e.g. { '--bg': '#FBF8FA' }
  order: number;
}

export interface ContrastPair {
  fg: string;
  bg: string;
  min: number;
  kind: 'text' | 'non-text';
}

/** Pairs from design.md §2.5: 4.5:1 for text, 3:1 for focus ring and status dots. */
export const PAIRS: ContrastPair[] = [
  ...(
    [
      ['--ink', '--bg'],
      ['--ink', '--paper'],
      ['--ink-2', '--bg'],
      ['--ink-2', '--paper'],
      ['--on-accent', '--accent'],
      ['--accent', '--accent-soft'],
      ['--toast-fg', '--toast-bg'],
      ['--urgent-text', '--bg'],
      ['--soon-text', '--bg'],
      ['--ok-text', '--bg'],
      ['--ink', '--blush'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 4.5, kind: 'text' as const })),
  ...(
    [
      ['--focus', '--bg'],
      ['--urgent', '--bg'],
      ['--soon', '--bg'],
      ['--ok', '--bg'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 3, kind: 'non-text' as const })),
];

/**
 * Parses `[data-x="y"]`, `[data-x='y']` and `[data-x=y]` parts of a `:root` selector.
 * Throws when a bracket cannot be read, so a formatting change can never make a
 * palette rule silently apply to every combination.
 */
export function parseAttributeSelectors(selector: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, part] of selector.matchAll(/\[([^\]]+)\]/g)) {
    const m = /^\s*([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*$/.exec(part as string);
    if (!m) throw new Error(`Unsupported attribute selector [${part}] in "${selector}"`);
    attrs[m[1] as string] = (m[2] ?? m[3] ?? m[4]) as string;
  }
  return attrs;
}

/** Extracts `:root[...]` rules and their custom properties (comments stripped). */
export function parseTokenRules(css: string): TokenRule[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: TokenRule[] = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRe.exec(clean)) !== null) {
    const selector = (match[1] ?? '').trim();
    if (!/^:root(\[[^\]]+\])*$/.test(selector)) continue;
    const attrs = parseAttributeSelectors(selector);
    const vars: Record<string, string> = {};
    for (const [, name, value] of (match[2] ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[name as string] = (value as string).trim();
    }
    rules.push({ attrs, vars, order: rules.length });
  }
  return rules;
}

/** Applies matching rules in cascade order (specificity = attribute count, then source order). */
export function composeTokens(rules: TokenRule[], theme: Theme, palette: Palette) {
  const active: Record<string, string> = { 'data-theme': theme, 'data-palette': palette };
  const matching = rules
    .filter((rule) => Object.entries(rule.attrs).every(([k, v]) => active[k] === v))
    .sort((a, b) => Object.keys(a.attrs).length - Object.keys(b.attrs).length || a.order - b.order);
  return Object.assign({}, ...matching.map((rule) => rule.vars)) as Record<string, string>;
}

export function parseHex(color: string): [number, number, number] {
  const hex = color.trim().replace(/^#/, '');
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`Not a hex color: ${color}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance(color: string): number {
  const [r, g, b] = parseHex(color).map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastResult extends ContrastPair {
  theme: Theme;
  palette: Palette;
  ratio: number;
  pass: boolean;
}

export function checkContrast(css: string): ContrastResult[] {
  const rules = parseTokenRules(css);
  const results: ContrastResult[] = [];
  for (const theme of THEMES) {
    for (const palette of PALETTES) {
      const tokens = composeTokens(rules, theme, palette);
      for (const pair of PAIRS) {
        const fg = tokens[pair.fg];
        const bg = tokens[pair.bg];
        if (!fg || !bg)
          throw new Error(`Missing token ${!fg ? pair.fg : pair.bg} (${theme}/${palette})`);
        const ratio = contrastRatio(fg, bg);
        results.push({ ...pair, theme, palette, ratio, pass: ratio >= pair.min });
      }
    }
  }
  return results;
}

function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const tokensPath = path.join(here, '..', 'web', 'src', 'styles', 'tokens.css');
  const results = checkContrast(readFileSync(tokensPath, 'utf8'));
  const rows = results.map((r) =>
    [
      r.pass ? 'ok  ' : 'FAIL',
      `${r.theme}/${r.palette}`.padEnd(16),
      `${r.fg} on ${r.bg}`.padEnd(28),
      r.ratio.toFixed(2).padStart(6),
      `(min ${r.min})`,
    ].join('  '),
  );
  console.log(rows.join('\n'));
  const failures = results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.error(
      `\n${failures.length} contrast pair(s) below threshold. Fix the token values in tokens.css.`,
    );
    process.exit(1);
  }
  console.log(`\nAll ${results.length} contrast checks pass (2 themes x 3 palettes).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
