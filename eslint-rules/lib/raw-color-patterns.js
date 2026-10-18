// Patterns for colors written as literals. Only `web/src/styles/tokens.css` may define colors;
// everything else must use the CSS custom properties.
import { CSS_NAMED_COLORS } from './css-named-colors.js';

// `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, not preceded by a word char or `&` (HTML entities like `&#123;`).
const HEX = /(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-zA-Z_-])/g;
// Legacy functional notations (whitespace before "(" tolerated).
const LEGACY_FUNC = /\b(?:rgba?|hsla?)\s*\(/gi;
// Modern color functions. CSS requires "(" right after the name, which also keeps prose such as
// "a lab (room 3)" from matching.
const MODERN_FUNC = /(?<![\w-])(?:color-mix|color|oklch|oklab|lch|lab|hwb)\(/gi;

/**
 * Returns every raw color occurrence in `text` with its index (hex and color functions).
 * @param {string} text
 * @returns {{ index: number, match: string }[]}
 */
export function findRawColorMatches(text) {
  /** @type {{ index: number, match: string }[]} */
  const found = [];
  for (const re of [HEX, LEGACY_FUNC, MODERN_FUNC]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      found.push({ index: m.index, match: m[0] });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

const COLOR_PROPERTY_EXACT = new Set([
  'color',
  'fill',
  'stroke',
  'box-shadow',
  'text-shadow',
  'caret-color',
  'accent-color',
  'stop-color',
  'flood-color',
  'lighting-color',
  'scrollbar-color',
  // Canvas 2D context properties.
  'fill-style',
  'stroke-style',
  'shadow-color',
]);
const COLOR_PROPERTY_PREFIXES = [
  'background',
  'border',
  'outline',
  'column-rule',
  'text-decoration',
];

/**
 * True for CSS properties (kebab-case or camelCase) whose value may hold a color.
 * Custom properties (`--x`) are not included: only tokens.css defines those with colors.
 * @param {string} name
 */
export function isColorProperty(name) {
  if (name.startsWith('--')) return false;
  const kebab = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).toLowerCase();
  if (COLOR_PROPERTY_EXACT.has(kebab)) return true;
  return COLOR_PROPERTY_PREFIXES.some((p) => kebab === p || kebab.startsWith(`${p}-`));
}

const NAMED_COLOR_WORD = /(?<![\w-])([a-z]+)(?![\w-])/gi;

/**
 * CSS named colors (e.g. `white`, `RebeccaPurple`) inside a property value. `var(...)` and
 * `url(...)` contents are ignored; `transparent`/`currentColor`/global keywords are allowed.
 * @param {string} value
 * @returns {{ index: number, match: string }[]}
 */
export function findNamedColors(value) {
  const masked = value.replace(/\b(?:var|url)\([^)]*\)/gi, (m) => ' '.repeat(m.length));
  /** @type {{ index: number, match: string }[]} */
  const found = [];
  NAMED_COLOR_WORD.lastIndex = 0;
  let m;
  while ((m = NAMED_COLOR_WORD.exec(masked)) !== null) {
    const word = m[1] ?? '';
    if (CSS_NAMED_COLORS.has(word.toLowerCase())) found.push({ index: m.index, match: word });
  }
  return found;
}
