import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRawColorsInText, scanRawColors, stripComments } from './check-raw-colors.js';

function makeRepo(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'sb colors Đồ án '));
  for (const [rel, text] of Object.entries(files)) {
    const full = path.join(root, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return root;
}

describe('raw color scan', () => {
  it('reports colors with file and line, skipping the tokens file and tests', () => {
    const root = makeRepo({
      'web/src/styles/tokens.css': ':root { --bg: #1C1622; }',
      'web/src/styles/base.css': 'body {\n  background: var(--bg);\n  color: #fff;\n}',
      'web/src/app/layout.tsx': 'const s = { border: "1px solid rgba(0,0,0,.1)" };',
      'web/src/app/layout.test.tsx': 'expect(bg).toBe("#1C1622");',
      'web/src/features/ok.ts': 'export const x = "var(--accent)";',
    });
    expect(scanRawColors(root)).toEqual([
      { file: 'web/src/app/layout.tsx', line: 1, match: 'rgba(' },
      { file: 'web/src/styles/base.css', line: 3, match: '#fff' },
    ]);
  });

  it('passes when web/src does not exist yet', () => {
    expect(scanRawColors(makeRepo({}))).toEqual([]);
  });

  it('ignores colors inside comments but keeps line numbers', () => {
    const css = '/* old: #fff\n   rgb(1,2,3) */\na { color: #000; }';
    expect(findRawColorsInText(css, 'css')).toEqual([{ line: 3, match: '#000' }]);
    const ts = '// was #fff\nconst url = "http://x/#/note";\nconst c = "#abc"; // #def';
    expect(findRawColorsInText(ts, 'ts')).toEqual([{ line: 3, match: '#abc' }]);
  });

  it('flags named colors and modern color functions in color properties only', () => {
    const css = [
      '.card {',
      '  color: White;',
      '  border-top: 1px solid var(--line);',
      '  box-shadow: 0 0 0 2px var(--focus),',
      '    0 0 6px tomato;',
      '  background: oklch(70% 0.1 300);',
      '  outline-color: transparent;',
      '  font-family: Tan, sans-serif;',
      '  content: "red";',
      '}',
      '.red:hover { fill: currentColor; }',
      '@media (prefers-color-scheme: dark) { a { stroke: navy } }',
    ].join('\n');
    expect(findRawColorsInText(css, 'css')).toEqual([
      { line: 2, match: 'White' },
      { line: 5, match: 'tomato' },
      { line: 6, match: 'oklch(' },
      { line: 12, match: 'navy' },
    ]);
  });

  it('does not treat named-color words in TS files as colors (the lint rule handles style objects)', () => {
    expect(findRawColorsInText('const label = "white board";', 'ts')).toEqual([]);
  });

  it('keeps URLs with double slashes intact when stripping comments', () => {
    expect(stripComments('const u = "http://localhost:4747/";', 'ts')).toContain(
      'http://localhost',
    );
  });
});
