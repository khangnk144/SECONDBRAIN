import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkLocaleFiles, compareLocales } from './check-i18n-parity.js';

describe('i18n parity', () => {
  it('accepts identical key trees with matching placeholders', () => {
    const vi = { nav: { today: 'Hôm nay' }, greet: 'Chào {{name}}' };
    const en = { nav: { today: 'Today' }, greet: 'Hello {{name}}' };
    expect(compareLocales(vi, en)).toEqual([]);
  });

  it('reports missing keys on either side', () => {
    const problems = compareLocales({ a: 'x', b: { c: 'y' } }, { a: 'x', d: 'z' });
    expect(problems).toContain('en.json: missing "b.c"');
    expect(problems).toContain('vi.json: missing "d"');
  });

  it('reports placeholder mismatches and empty strings', () => {
    const problems = compareLocales(
      { summary: 'Còn {{m}} việc', empty: ' ' },
      { summary: 'There are {{n}} tasks', empty: 'Empty' },
    );
    expect(problems).toContain('vi.json: "empty" is empty');
    expect(problems.some((p) => p.startsWith('"summary": placeholders differ'))).toBe(true);
  });

  it('groups plural variants so Vietnamese may use only _other', () => {
    const vi = { tasks_other: '{{count}} việc' };
    const en = { tasks_one: '{{count}} task', tasks_other: '{{count}} tasks' };
    expect(compareLocales(vi, en)).toEqual([]);
  });

  it('accepts formatted placeholders such as {{date, short}}', () => {
    expect(compareLocales({ d: 'Ngày {{date, short}}' }, { d: 'Date {{date}}' })).toEqual([]);
  });

  it('rejects non-string leaves', () => {
    expect(compareLocales({ a: 1 } as never, { a: 'x' })).toContain(
      'vi.json: "a" must be a string or an object',
    );
  });

  it('reads the locale files from web/src/i18n and reports missing files', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sb i18n Tiếng Việt '));
    expect(checkLocaleFiles(root)).toEqual([
      'vi.json: file not found in web/src/i18n',
      'en.json: file not found in web/src/i18n',
    ]);
    mkdirSync(path.join(root, 'web/src/i18n'), { recursive: true });
    writeFileSync(path.join(root, 'web/src/i18n/vi.json'), JSON.stringify({ a: 'Một' }));
    writeFileSync(path.join(root, 'web/src/i18n/en.json'), JSON.stringify({ a: 'One' }));
    expect(checkLocaleFiles(root)).toEqual([]);
  });
});
