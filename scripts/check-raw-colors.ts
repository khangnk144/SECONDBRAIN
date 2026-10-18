// Fails when a color is written as a literal anywhere in web/src outside the design tokens.
// Usage: tsx scripts/check-raw-colors.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  findNamedColors,
  findRawColorMatches,
  isColorProperty,
} from '../eslint-rules/lib/raw-color-patterns.js';
import { appRoot, isMainModule, listFiles, toRepoPath } from './lib/script-utils.js';

export interface RawColorFinding {
  file: string;
  line: number;
  match: string;
}

const TOKENS_FILE = 'web/src/styles/tokens.css';
const TEST_FILE = /\.test\.(ts|tsx)$/;

/** Blanks out comments while keeping line numbers. `//` only counts at line start or after space. */
export function stripComments(text: string, kind: 'css' | 'ts'): string {
  const keepNewlines = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = text.replace(/\/\*[\s\S]*?\*\//g, keepNewlines);
  if (kind === 'ts') out = out.replace(/(^|[ \t])\/\/[^\n]*/gm, (m) => keepNewlines(m));
  return out;
}

// `property: value` inside a CSS block. The name must start a declaration (line start, `{`, `;`
// or whitespace before it), so selectors like `a:hover` or `(prefers-color-scheme: dark)` never
// count as a color property.
const CSS_DECLARATION = /(^|[;{\s])([a-zA-Z-]+)\s*:\s*([^;{}]*)/g;

/** Named colors (`white`, `red`, …) used as values of color properties in CSS text. */
export function findNamedColorsInCss(cssWithoutComments: string): Omit<RawColorFinding, 'file'>[] {
  const findings: Omit<RawColorFinding, 'file'>[] = [];
  CSS_DECLARATION.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CSS_DECLARATION.exec(cssWithoutComments)) !== null) {
    const [, , property = '', value = ''] = m;
    if (!isColorProperty(property)) continue;
    const valueStart = m.index + m[0].length - value.length;
    for (const named of findNamedColors(value)) {
      const before = cssWithoutComments.slice(0, valueStart + named.index);
      findings.push({ line: before.split('\n').length, match: named.match });
    }
  }
  return findings;
}

/** Raw colors in one file's text; line numbers are 1-based. */
export function findRawColorsInText(
  text: string,
  kind: 'css' | 'ts',
): Omit<RawColorFinding, 'file'>[] {
  const stripped = stripComments(text, kind);
  const findings: Omit<RawColorFinding, 'file'>[] = [];
  stripped.split('\n').forEach((lineText, i) => {
    for (const { match } of findRawColorMatches(lineText)) findings.push({ line: i + 1, match });
  });
  if (kind === 'css') findings.push(...findNamedColorsInCss(stripped));
  return findings.sort((a, b) => a.line - b.line);
}

/** Scans `<root>/web/src` (css, ts, tsx), skipping the tokens file and tests. */
export function scanRawColors(root = appRoot): RawColorFinding[] {
  const srcDir = path.join(root, 'web', 'src');
  const files = listFiles(srcDir, (name) => /\.(css|ts|tsx)$/.test(name) && !TEST_FILE.test(name));
  const findings: RawColorFinding[] = [];
  for (const file of files) {
    const rel = toRepoPath(file, root);
    if (rel === TOKENS_FILE || rel.includes('/__tests__/')) continue;
    const kind = file.endsWith('.css') ? 'css' : 'ts';
    for (const f of findRawColorsInText(readFileSync(file, 'utf8'), kind)) {
      findings.push({ file: rel, ...f });
    }
  }
  return findings;
}

if (isMainModule(import.meta.url)) {
  const findings = scanRawColors();
  if (findings.length > 0) {
    console.error(`Raw colors found (use tokens from ${TOKENS_FILE}):`);
    for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.match}`);
    process.exit(1);
  }
  console.log('check-raw-colors: ok');
}
