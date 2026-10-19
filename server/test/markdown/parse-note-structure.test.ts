import { describe, expect, it } from 'vitest';
import type { ParsedNote } from '../../src/markdown/markdown-types.js';
import { parseNote } from '../../src/markdown/parse-note.js';
import { buildLineStarts, lineOfOffset } from '../../src/markdown/source-lines.js';
import { fixtureNames, fixtureVariants, readFixture } from './helpers/markdown-fixtures.js';

/** Everything that must not depend on line endings, a BOM or NFC/NFD. */
function shape(note: ParsedNote) {
  const nfc = (value: string | null) => value?.normalize('NFC') ?? null;
  return {
    links: note.links.map((link) => [
      link.kind,
      nfc(link.raw),
      nfc(link.target),
      link.line,
      link.frontmatterKey,
    ]),
    tags: note.tags.map((tag) => [tag.norm, tag.line, tag.source]),
    tasks: note.tasks.map((task) => [
      task.line,
      task.done,
      nfc(task.text),
      task.due,
      task.completed,
    ]),
    headings: note.headings.map((heading) => [heading.depth, nfc(heading.text), heading.line]),
    frontmatter: note.frontmatter.present
      ? [note.frontmatter.startLine, note.frontmatter.endLine]
      : null,
    words: note.wordCount,
  };
}

describe('parseNote positions on the original text (LF, CRLF, BOM, NFD)', () => {
  for (const name of fixtureNames()) {
    it(`${name}: offsets, lines and line texts point into the original content`, () => {
      const reference = shape(parseNote(readFixture(name)));
      for (const { label, content } of fixtureVariants(readFixture(name))) {
        const note = parseNote(content);
        const starts = buildLineStarts(content);
        const lines = content.split(/\r\n|\n|\r/);
        for (const link of note.links) {
          expect(content.slice(link.start, link.end), label).toBe(link.raw);
          expect(lineOfOffset(starts, link.start), label).toBe(link.line);
        }
        for (const task of note.tasks) expect(task.lineText, label).toBe(lines[task.line - 1]);
        for (const tag of note.tags.filter((t) => t.source === 'inline')) {
          expect(lines[tag.line - 1]?.includes(`#${tag.tag}`), label).toBe(true);
        }
        expect(shape(note), label).toEqual(reference);
        expect(note.lineEnding, label).toBe(label.includes('CRLF') ? '\r\n' : '\n');
      }
    });
  }
});

describe('parseNote headings, text and counts', () => {
  it('reports ATX (1–6, closing #s removed) and setext headings with their lines', () => {
    const note = parseNote(readFixture('structure-mixed.md'));
    expect(note.headings).toEqual([
      { depth: 1, text: 'Tiêu đề setext', line: 1 },
      { depth: 4, text: 'Tiêu đề bốn', line: 11 },
      { depth: 6, text: 'Sáu', line: 13 },
    ]);
    expect(parseNote('# A [[B|bee]] `c`\n####### not').headings).toEqual([
      { depth: 1, text: 'A bee c', line: 1 },
    ]);
  });

  it('builds readable text: syntax removed, wikilinks as alias/target, code kept, no YAML', () => {
    const note = parseNote(readFixture('frontmatter-comments-nested.md'));
    expect(note.plainText).toBe(
      'Đồ án giải tích\nNội dung chính với Giải tích 1 và #tag-trong-bài.',
    );
    const mixed = parseNote(readFixture('structure-mixed.md')).plainText;
    expect(mixed).toContain(
      'Đoạn văn với đậm, nghiêng, gạch dưới, gạch ngang, mã, & và #thực-thể.',
    );
    expect(mixed).toContain('Trích dẫn có Trong trích dẫn\ntiếp tục lười.');
    expect(mixed).not.toContain('<summary>');
    const code = parseNote('Text\n\n```\nconst x = [[Kept]];\n```\n').plainText;
    expect(code).toBe('Text\nconst x = [[Kept]];');
  });

  it('counts Unicode words (Vietnamese syllables, NFD, apostrophes)', () => {
    expect(parseNote('Giải tích 1 — đồ án!').wordCount).toBe(5);
    expect(parseNote('Giải tích 1 — đồ án!'.normalize('NFD')).wordCount).toBe(5);
    expect(parseNote("don't stop 😀 #tag").wordCount).toBe(3);
    expect(parseNote('---\ntitle: không đếm\n---\n').wordCount).toBe(0);
  });

  it('detects the dominant line ending', () => {
    expect(parseNote('a\r\nb\r\nc\n').lineEnding).toBe('\r\n');
    expect(parseNote('a\nb\r\nc\n').lineEnding).toBe('\n');
    expect(parseNote('single line').lineEnding).toBe('\n');
  });

  it('handles empty and whitespace-only notes', () => {
    for (const content of ['', '﻿', '\n\n', '   \t']) {
      const note = parseNote(content);
      expect(note.links).toEqual([]);
      expect(note.plainText).toBe('');
      expect(note.wordCount).toBe(0);
    }
  });
});
