/**
 * Contrast check for the design tokens (design.md §2.5, and §12.8 for the Bento style).
 * Parses web/src/styles/tokens.css, composes every theme × palette combination the
 * way the CSS cascade would – for the calm style and under `data-style="bento"` – and verifies
 * each listed pair. Exit code 1 on failure.
 * Fix failing token values in tokens.css; never lower the thresholds.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { opaqueHex, parseHex, resolveColor } from './contrast-colors.js';
import { PAIRS_BY_STYLE, type ContrastPair, type Style } from './contrast-pairs.js';

export { opaqueHex, parseHex, resolveColor } from './contrast-colors.js';
export {
  BENTO_PAIRS,
  BENTO_SELECTED_PAIRS,
  BENTO_STATUS_PAIRS,
  PAIRS,
  PAIRS_BY_STYLE,
  type ContrastPair,
  type Style,
} from './contrast-pairs.js';

export type Theme = 'dark' | 'light';
export type Palette = 'dau-tam' | 'hoa-dao' | 'oai-huong';
export const THEMES: Theme[] = ['dark', 'light'];
export const PALETTES: Palette[] = ['dau-tam', 'hoa-dao', 'oai-huong'];

export interface TokenRule {
  attrs: Record<string, string>; // e.g. { 'data-theme': 'light' }
  vars: Record<string, string>; // e.g. { '--bg': '#FBF8FA' }
  order: number;
}

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
export function composeTokens(
  rules: TokenRule[],
  theme: Theme,
  palette: Palette,
  style: Style = 'calm',
) {
  const active: Record<string, string> = {
    'data-theme': theme,
    'data-palette': palette,
    'data-style': style,
  };
  const matching = rules
    .filter((rule) => Object.entries(rule.attrs).every(([k, v]) => active[k] === v))
    .sort((a, b) => Object.keys(a.attrs).length - Object.keys(b.attrs).length || a.order - b.order);
  return Object.assign({}, ...matching.map((rule) => rule.vars)) as Record<string, string>;
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
  style: Style;
  ratio: number;
  pass: boolean;
}

export function checkContrast(css: string): ContrastResult[] {
  const rules = parseTokenRules(css);
  const results: ContrastResult[] = [];
  for (const style of ['calm', 'bento'] as const) {
    for (const theme of THEMES) {
      for (const palette of PALETTES) {
        const tokens = composeTokens(rules, theme, palette, style);
        for (const pair of PAIRS_BY_STYLE[style]) {
          const missing = [pair.fg, pair.bg, pair.over].find((n) => n && !tokens[n]);
          if (missing) throw new Error(`Missing token ${missing} (${style}/${theme}/${palette})`);
          // Values may be var() references or a wash laid over `over` (contrast-colors.ts).
          const under = pair.over ? resolveColor(tokens[pair.over] as string, tokens) : undefined;
          const bg = opaqueHex(resolveColor(tokens[pair.bg] as string, tokens), under);
          const fg = opaqueHex(resolveColor(tokens[pair.fg] as string, tokens), {
            rgb: parseHex(bg),
            alpha: 1,
          });
          const ratio = contrastRatio(fg, bg);
          results.push({ ...pair, theme, palette, style, ratio, pass: ratio >= pair.min });
        }
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
      `${r.style}/${r.theme}/${r.palette}`.padEnd(22),
      `${r.fg} on ${r.bg}${r.over ? ` over ${r.over}` : ''}`.padEnd(32),
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
  console.log(
    `\nAll ${results.length} contrast checks pass (2 themes x 3 palettes, calm and bento).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
