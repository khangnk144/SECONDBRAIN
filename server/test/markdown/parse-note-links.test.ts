import { describe, expect, it } from 'vitest';
import { parseNote } from '../../src/markdown/parse-note.js';
import { readFixture } from './helpers/markdown-fixtures.js';

const linksOf = (content: string) =>
  parseNote(content).links.map((link) => [link.kind, link.target, link.heading, link.alias]);

describe('parseNote wikilinks', () => {
  const note = parseNote(readFixture('links-every-form.md'));
  const wikilinks = note.links.filter((link) => link.kind !== 'markdown');

  it('parses every wikilink form', () => {
    expect(wikilinks.map((link) => [link.kind, link.target, link.heading, link.alias])).toEqual([
      ['wikilink', 'Bài 1', null, null],
      ['wikilink', 'Bài 1', null, 'bài một'],
      ['wikilink', 'Bài 1', 'Ý chính', null],
      ['wikilink', 'Bài 1', 'Ý chính', 'xem'],
      ['wikilink', '2 Areas/Giải tích 1', null, null],
      ['wikilink', '2 Areas/Giải tích 1.md', null, null],
      ['embed', 'sơ đồ.png', null, null],
      ['wikilink', 'bài giảng 3.pdf', null, null],
      ['wikilink', '', 'Tóm tắt', null],
      ['wikilink', 'Bài 3', null, null],
      ['wikilink', 'Bài 1', null, 'bài một'],
      ['wikilink', 'Ngoài HTML', null, null],
    ]);
  });

  it('never finds links in fenced, indented or inline code, or in raw HTML (F4.2)', () => {
    const targets = wikilinks.map((link) => link.target);
    expect(targets).not.toContain('Trong code');
    expect(targets).not.toContain('Trong HTML');
    expect(wikilinks.filter((link) => link.target === 'Bài 1')).toHaveLength(5);
    expect(wikilinks.every((link) => link.line <= 13)).toBe(true);
  });

  it('accepts `\\|` as the alias separator (tables) and keeps it in raw', () => {
    const tableLink = wikilinks.find((link) => link.line === 10);
    expect(tableLink?.raw).toBe('[[Bài 1\\|bài một]]');
    expect(tableLink?.alias).toBe('bài một');
  });

  it('reports the embed span including its `!`, with exact offsets', () => {
    const content = readFixture('links-every-form.md');
    const embed = wikilinks.find((link) => link.kind === 'embed');
    expect(embed?.raw).toBe('![[sơ đồ.png]]');
    for (const link of note.links) expect(content.slice(link.start, link.end)).toBe(link.raw);
  });

  it('ignores `[[]]`, `[[|x]]`, escaped `\\[[x]]` and unterminated or multi-line brackets', () => {
    expect(linksOf('[[]] [[ ]] [[|x]] \\[[x]] [[open\nclose]] [[x')).toEqual([]);
    expect(linksOf('\\\\[[escaped backslash]]')).toEqual([
      ['wikilink', 'escaped backslash', null, null],
    ]);
    expect(linksOf('[[a [[b]]')).toEqual([['wikilink', 'b', null, null]]);
  });

  it('finds links in NFD text with the target as written', () => {
    const [link] = parseNote('Xem [[Giải tích 1]]'.normalize('NFD')).links;
    expect(link?.target.normalize('NFC')).toBe('Giải tích 1');
  });
});

describe('parseNote Markdown links', () => {
  const note = parseNote(readFixture('links-every-form.md'));
  const markdown = note.links.filter((link) => link.kind === 'markdown');

  it('reports relative links and images with percent-decoded targets and anchors', () => {
    expect(markdown.map((link) => [link.target, link.heading])).toEqual([
      ['../Toán/Bài 1.md', 'Ý chính'],
      ['notes/b.md', null],
      ['Attachments/2026-10/ảnh.png', null],
      ['a b.md', null],
    ]);
    expect(markdown[0]?.raw).toBe('[tương đối](../Toán/Bài%201.md#Ý%20chính)');
  });

  it('skips absolute URLs, mailto, protocol-relative and bare fragments', () => {
    const targets = markdown.map((link) => link.target);
    expect(targets.some((target) => /example|mailto|Tóm-tắt/.test(target))).toBe(false);
    expect(linksOf('[a](//host/x.md) [b]() [c](?q=1) [d](C:\\x.md)')).toEqual([]);
  });

  it('follows CommonMark precedence: code spans and HTML win, links cannot nest', () => {
    expect(linksOf('[a `](b.md)` c](d.md)')).toEqual([['markdown', 'd.md', null, null]]);
    expect(linksOf('[x <a href="](y.md)">](z.md)')).toEqual([['markdown', 'z.md', null, null]]);
    expect(linksOf('[a [b](c.md) d](e.md)')).toEqual([['markdown', 'c.md', null, null]]);
    // Sorted by start: the outer link starts before the image inside its label.
    expect(linksOf('[![img](i.png)](t.md)').map((link) => link[1])).toEqual(['t.md', 'i.png']);
    expect(linksOf('\\[a](b.md)')).toEqual([]);
  });

  it('does not report reference-style links as Markdown links', () => {
    const note = parseNote(readFixture('definitions-footnotes.md'));
    expect(note.links.map((link) => [link.kind, link.target])).toEqual([
      ['wikilink', 'Bài 1'],
      ['wikilink', 'Trong chú thích'],
    ]);
  });

  it('lets references consume brackets like links do', () => {
    // `[b][r]` is a reference, so the outer `[` is inactive and `(d.md)` is plain text.
    expect(linksOf('[a [b][r] c](d.md)\n\n[r]: /x')).toEqual([]);
    expect(linksOf('[a [b][undefined] c](d.md)')).toEqual([['markdown', 'd.md', null, null]]);
    // A defined footnote call is never a bracket.
    expect(linksOf('[^1](x.md)\n\n[^1]: note')).toEqual([]);
  });

  it('treats GFM URL literals as text, even when they run into brackets', () => {
    expect(linksOf('see https://x.com/a[b](c.md) here')).toEqual([]);
    expect(linksOf('see https://x.com/a [b](c.md)')).toEqual([['markdown', 'c.md', null, null]]);
    expect(linksOf('[see https://x.com](y.md)')).toEqual([['markdown', 'y.md', null, null]]);
  });
});
