import { beforeAll, describe, expect, it } from 'vitest';

// The web test project loads CSS as empty modules, so read the files from disk. (Module names in
// variables keep Vite from resolving them; `new URL(dir, import.meta.url)` would be rewritten.)
const FS = 'node:fs';
const PATH = 'node:path';
const NODE_URL = 'node:url';
interface Fs {
  readFileSync(path: string, encoding: 'utf8'): string;
  readdirSync(path: string, options: { recursive: true }): string[];
}
interface PathModule {
  dirname(path: string): string;
  join(...parts: string[]): string;
}

interface CssRule {
  file: string;
  selectors: string[];
  body: string;
}

let rules: CssRule[] = [];

/** Every plain rule of every stylesheet under web/src (comments removed). */
async function readRules(): Promise<CssRule[]> {
  const fs = (await import(/* @vite-ignore */ FS)) as Fs;
  const path = (await import(/* @vite-ignore */ PATH)) as PathModule;
  const { fileURLToPath } = (await import(/* @vite-ignore */ NODE_URL)) as {
    fileURLToPath(url: string): string;
  };
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const found: CssRule[] = [];
  for (const file of fs.readdirSync(root, { recursive: true })) {
    if (!file.endsWith('.css')) continue;
    const css = fs.readFileSync(path.join(root, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (match[1] ?? '').split(',').map((part) => part.trim().replace(/\s+/g, ' '));
      found.push({ file, selectors, body: match[2] ?? '' });
    }
  }
  return found;
}

const declares = (body: string, property: string, value: string) =>
  new RegExp(`(^|[;\\s])${property}:\\s*${value.replace(/[()-]/g, '\\$&')}\\s*(;|$)`).test(body);

// design.md §2.5 / SPEC §5: text needs 4.5:1, and --ink-2 on --accent-soft falls below it in
// five of the six theme × palette sets (the contrast script checks --ink on --accent-soft).
describe('text on --accent-soft surfaces', () => {
  beforeAll(async () => {
    rules = await readRules();
  });

  it('no rule puts --ink-2 text on an --accent-soft background', () => {
    const offenders = rules.filter(
      (rule) =>
        declares(rule.body, 'background', 'var(--accent-soft)') &&
        declares(rule.body, 'color', 'var(--ink-2)'),
    );
    expect(offenders.map((rule) => `${rule.file}: ${rule.selectors.join(', ')}`)).toEqual([]);
  });

  it.each([
    '.target-chooser__option:has(input:checked) .target-chooser__folder',
    ".history-list__item[aria-current='true'] .history-list__detail",
    '.graph-results__item.is-active .graph-results__folder',
    ".editor-popup__option[aria-selected='true'] .editor-popup__meta",
    ".editor-popup__option[aria-selected='true'] .tag-option__parent",
    '.palette-option.is-active .palette-option__folder',
    '.calendar-cell.is-selected .calendar-cell__more',
    '.source-editor__uploads li',
    '.upload-placeholder',
  ])('secondary text on a selected or soft row uses --ink: %s', (selector) => {
    const rule = rules.find(
      (candidate) =>
        candidate.selectors.includes(selector) && declares(candidate.body, 'color', 'var(--ink)'),
    );
    expect(rule, selector).toBeDefined();
  });
});
