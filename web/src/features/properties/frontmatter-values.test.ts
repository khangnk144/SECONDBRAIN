// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { frontmatterYaml, isIsoDate, parseFrontmatter, wikilinkText } from './frontmatter-values';

describe('front matter values for the property bar (F7)', () => {
  it('reads keys in file order with their kinds; dates stay strings (core schema)', () => {
    const raw = [
      '---',
      'type: project          # loại',
      'status: doing',
      'deadline: 2026-11-05',
      'course: "[[Giải tích 1]]"',
      'tags: [đồ-án, giải-tích]',
      '2024: năm',
      'pages: 12',
      'nested:',
      '  - [a, b]',
      '---',
      '',
    ].join('\r\n');
    const parsed = parseFrontmatter(raw);
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;
    expect(parsed.entries.map((e) => [e.key, e.kind, e.value])).toEqual([
      ['type', 'type', 'project'],
      ['status', 'status', 'doing'],
      ['deadline', 'date', '2026-11-05'],
      ['course', 'course', '[[Giải tích 1]]'],
      ['tags', 'tags', ['đồ-án', 'giải-tích']],
      ['2024', 'text', 'năm'],
      ['pages', 'text', 12],
      ['nested', 'complex', [['a', 'b']]],
    ]);
    expect(parsed.entries[7]?.yaml).toBe('- [a, b]');
  });

  it('reports invalid YAML, duplicate keys and non-mapping roots as invalid (F7.2)', () => {
    expect(parseFrontmatter('---\ntitle: [unclosed\n---\n').status).toBe('invalid');
    expect(parseFrontmatter('---\na: 1\na: 2\n---\n').status).toBe('invalid');
    expect(parseFrontmatter('---\n- a\n- b\n---\n').status).toBe('invalid');
    expect(parseFrontmatter('---\n{a: 1}\n---\n').status).toBe('invalid');
  });

  it('handles no front matter, an empty block and the ... closer', () => {
    expect(parseFrontmatter(null)).toEqual({ status: 'none' });
    expect(parseFrontmatter('---\n---\n')).toEqual({ status: 'ok', entries: [] });
    expect(frontmatterYaml('\uFEFF---\na: 1\n...\n')).toBe('a: 1');
  });

  it('validates calendar dates and reads wikilink values', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(wikilinkText('[[Giải tích 1]]')).toBe('Giải tích 1');
    expect(wikilinkText('[[2 Areas/Giải tích 1]]')).toBe('Giải tích 1');
    expect(wikilinkText('[[Giải tích 1|GT1]]')).toBe('GT1');
    expect(wikilinkText('văn bản')).toBe('văn bản');
  });
});
