import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/markdown/parse-note.js';
import { readFixture } from './helpers/markdown-fixtures.js';

describe('parseNote front matter (F7.2)', () => {
  it('parses YAML with comments, nested values and quoted strings; dates stay strings', () => {
    const note = parseNote(readFixture('frontmatter-comments-nested.md'));
    expect(note.frontmatter).toMatchObject({
      present: true,
      error: null,
      startLine: 1,
      endLine: 15,
    });
    expect(note.frontmatter.data).toEqual({
      type: 'project',
      status: 'doing',
      deadline: '2026-11-05',
      course: '[[Giải tích 1]]',
      related: ['[[Bài 1|bài một]]', '[[2 Areas/Toán/Bài 2#Ý chính]]'],
      meta: { owner: 'khangnie', links: ['[[Đồ án]]'] },
      tags: ['đồ-án', '#giải-tích', 'môn/toán'],
      created: '2026-10-18',
    });
    expect(note.frontmatter.raw?.startsWith('# Course project')).toBe(true);
    expect(note.frontmatter.raw?.endsWith('created: 2026-10-18')).toBe(true);
  });

  it('keeps the raw text of invalid YAML and reports the error without data', () => {
    const content = readFixture('frontmatter-invalid.md');
    const note = parseNote(content);
    expect(note.frontmatter.present).toBe(true);
    expect(note.frontmatter.data).toBeNull();
    expect(note.frontmatter.error).toEqual(expect.any(String));
    expect(note.frontmatter.raw).toBe('title: [unclosed\ncourse: "[[Giải tích 1]]"');
    // The body is still parsed normally after the block.
    expect(note.links.map((link) => link.target)).toEqual(['Giải tích 1', 'Link']);
  });

  it('accepts a BOM, CRLF line endings and a `...` closing fence', () => {
    const content = '\uFEFF---\r\ntype: note\r\ntags: [a]\r\n...\r\nBody #b\r\n';
    const note = parseNote(content);
    expect(note.frontmatter).toMatchObject({ present: true, data: { type: 'note', tags: ['a'] } });
    expect(note.frontmatter.raw).toBe('type: note\r\ntags: [a]');
    expect(note.frontmatter.endLine).toBe(4);
    expect(note.tags.map((tag) => [tag.tag, tag.line])).toEqual([
      ['a', 3],
      ['b', 5],
    ]);
    expect(note.lineEnding).toBe('\r\n');
  });

  it('treats an empty block as an empty mapping and a scalar block as an error', () => {
    expect(parseNote('---\n---\nx').frontmatter).toMatchObject({
      present: true,
      raw: '',
      data: {},
    });
    const scalar = parseNote('---\njust text\n---\n').frontmatter;
    expect(scalar).toMatchObject({ present: true, data: null });
    expect(scalar.error).toEqual(expect.any(String));
  });

  it('only recognises front matter at the very start of the file', () => {
    expect(parseNote('\n---\na: 1\n---\n').frontmatter.present).toBe(false);
    expect(parseNote('---\na: 1\nno closing fence\n').frontmatter.present).toBe(false);
    expect(parseNote('--- \na: 1\n--- \n').frontmatter.present).toBe(true);
  });

  it('does not warn on template placeholders that YAML reads as flow maps', () => {
    const note = parseNote('---\ncreated: {{date}}\ntitle: "{{title}}"\n---\n');
    expect(note.frontmatter.error).toBeNull();
    expect(note.frontmatter.data?.['title']).toBe('{{title}}');
  });
});

describe('front-matter wikilinks and tags', () => {
  it('reports links inside YAML with the key they belong to, skipping comments', () => {
    const note = parseNote(readFixture('frontmatter-comments-nested.md'));
    const yamlLinks = note.links.filter((link) => link.frontmatterKey !== null);
    expect(yamlLinks.map((link) => [link.raw, link.frontmatterKey, link.line])).toEqual([
      ['[[Giải tích 1]]', 'course', 6],
      ['[[Bài 1|bài một]]', 'related', 8],
      ['[[2 Areas/Toán/Bài 2#Ý chính]]', 'related', 9],
      ['[[Đồ án]]', 'links', 12],
    ]);
    expect(note.links.some((link) => link.target === 'Not A Link')).toBe(false);
  });

  it('finds the parent key of list items written at the key indentation', () => {
    const note = parseNote('---\nrelated:\n- "[[A]]"\n- [[B]]\nnext: "[[C]]"\n---\n');
    expect(note.links.map((link) => [link.target, link.frontmatterKey])).toEqual([
      ['A', 'related'],
      ['B', 'related'],
      ['C', 'next'],
    ]);
  });

  it('decodes YAML escapes around links in quoted values; raw stays the file text', () => {
    const note = parseNote(
      `---\nsingle: '[[Bob''s notes]]'\ndouble: "[[Say \\"hi\\"|x]]"\nplain: [[It's]]\n---\n`,
    );
    expect(note.frontmatter.error).toBeNull();
    expect(note.links.map((link) => [link.raw, link.target, link.alias])).toEqual([
      ["[[Bob''s notes]]", "Bob's notes", null],
      ['[[Say \\"hi\\"|x]]', 'Say "hi"', 'x'],
      ["[[It's]]", "It's", null],
    ]);
  });

  it('finds keys in linear time on very long lines', () => {
    const long = `---\n${`a${' '.repeat(20000)}b\n`.repeat(20)}k: "[[X]]"\n---\n`;
    const started = performance.now();
    const note = parseNote(long);
    expect(performance.now() - started).toBeLessThan(500);
    expect(note.links[0]?.frontmatterKey).toBe('k');
    expect(parseNote('---\na:b: "[[Y]]"\n---\n').links[0]?.frontmatterKey).toBe('a:b');
  });

  it('reads tags from a list or a comma/space separated string, dropping a leading #', () => {
    const fromList = parseNote(readFixture('frontmatter-comments-nested.md')).tags;
    expect(fromList.filter((t) => t.source === 'frontmatter').map((t) => [t.tag, t.line])).toEqual([
      ['đồ-án', 13],
      ['giải-tích', 13],
      ['môn/toán', 13],
    ]);
    const fromString = parseNote(readFixture('tags-and-tasks.md')).tags;
    expect(fromString.filter((t) => t.source === 'frontmatter').map((t) => t.tag)).toEqual([
      'đồ-án',
      'giải-tích',
      'bài-tập',
    ]);
    expect(fromString[0]?.norm).toBe('dồ-án');
  });
});
