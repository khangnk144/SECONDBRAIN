/**
 * The token pairs `check-contrast.ts` verifies, per style. Thresholds are WCAG: 4.5:1 for text,
 * 3:1 for non-text marks (focus ring, status dots and bars, chart pastels). Never lower them;
 * fix the token value in web/src/styles/tokens.css instead.
 */

/** `data-style` on <html>: calm = no bento rule applies (the attribute is 'calm'). */
export type Style = 'calm' | 'bento';

export interface ContrastPair {
  fg: string;
  bg: string;
  /** `bg` is a translucent wash: it is laid over this opaque token first, as on screen. */
  over?: string;
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
      // Text on selected rows and other --accent-soft surfaces (secondary text included).
      ['--ink', '--accent-soft'],
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
 * Pairs from design.md §12.8, checked under `data-style="bento"`: text on tiles and inner rows,
 * the "Ngày" tile (`--on-tint` on BOTH ends of the `--tint` gradient) and the primary button at
 * 4.5:1; pastels and the accent (charts, bars, dots, chips) against the tile at 3:1. The
 * gradient border (`--tile-border`) is decoration and not checked.
 */
export const BENTO_PAIRS: ContrastPair[] = [
  ...(
    [
      ['--ink', '--tile'],
      ['--ink-2', '--tile'],
      ['--ink', '--tile-2'],
      ['--ink-2', '--tile-2'],
      ['--on-tint', '--tint-from'],
      ['--on-tint', '--tint-to'],
      ['--on-accent', '--accent'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 4.5, kind: 'text' as const })),
  ...(
    [
      ['--pastel-lilac', '--tile'],
      ['--pastel-peach', '--tile'],
      ['--pastel-mint', '--tile'],
      ['--pastel-butter', '--tile'],
      ['--accent', '--tile'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 3, kind: 'non-text' as const })),
];

/**
 * Bento also puts status text and marks on tiles (task sub-lines "Quá hạn 1 ngày" on --tile-2,
 * urgency bars in the strip's day cells, the focus ring around controls inside tiles).
 */
export const BENTO_STATUS_PAIRS: ContrastPair[] = [
  ...(
    [
      ['--urgent-text', '--tile'],
      ['--soon-text', '--tile'],
      ['--ok-text', '--tile'],
      ['--urgent-text', '--tile-2'],
      ['--soon-text', '--tile-2'],
      ['--ok-text', '--tile-2'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 4.5, kind: 'text' as const })),
  ...(
    [
      ['--focus', '--tile'],
      ['--focus', '--tile-2'],
      ['--urgent', '--tile-2'],
      ['--soon', '--tile-2'],
      ['--ok', '--tile-2'],
    ] as const
  ).map(([fg, bg]) => ({ fg, bg, min: 3, kind: 'non-text' as const })),
];

/**
 * Selected items on the accent wash (§12.2: the active rail entry's icon and label "in the
 * accent" on its 18 % wash): `--accent-ink` on `--accent-wash` laid over the rail's `--tile`.
 */
export const BENTO_SELECTED_PAIRS: ContrastPair[] = [
  { fg: '--accent-ink', bg: '--accent-wash', over: '--tile', min: 4.5, kind: 'text' },
];

const unique = (pairs: ContrastPair[]): ContrastPair[] => {
  const seen = new Set<string>();
  const key = (p: ContrastPair) => `${p.fg} ${p.bg} ${p.over ?? ''}`;
  return pairs.filter((p) => !seen.has(key(p)) && seen.add(key(p)));
};

/**
 * Which pairs each style checks. Calm: the §2.5 set. Bento: the §2.5 set again (bento changes
 * `--bg`, and it is the default style), the §12.8 set, the status pairs on tiles and the
 * selected item on the accent wash.
 */
export const PAIRS_BY_STYLE: Record<Style, ContrastPair[]> = {
  calm: PAIRS,
  bento: unique([...PAIRS, ...BENTO_PAIRS, ...BENTO_STATUS_PAIRS, ...BENTO_SELECTED_PAIRS]),
};
