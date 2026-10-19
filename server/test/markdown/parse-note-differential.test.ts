/**
 * The fast line scanner must give exactly the same note structure as the full remark parse
 * (the reference). Compared: links, tags, tasks, headings and the readable text. The text is
 * compared without `*`, `_`, `~` and whitespace differences (emphasis markers only affect
 * snippets), and one documented text-only quirk of the reference parser is masked.
 */
import { describe, expect, it } from 'vitest';
import { FullParseRequired } from '../../src/markdown/fast-block-types.js';
import { fastNoteStructure } from '../../src/markdown/fast-note-structure.js';
import type { ParsedNote } from '../../src/markdown/markdown-types.js';
import { mdastNoteStructure } from '../../src/markdown/mdast-note-structure.js';
import { parseNote, parseNoteUsing } from '../../src/markdown/parse-note.js';
import { fixtureNames, fixtureVariants, readFixture } from './helpers/markdown-fixtures.js';
import { createRandom, fuzzDocument } from './helpers/markdown-fuzz.js';

// Text-only difference accepted on purpose: after an empty list item the reference drops a
// `[ ]` that starts the next paragraph, so checkbox tokens are ignored in the readable text.
const squash = (text: string) =>
  text
    .replace(/\[[ xX]\]/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

function comparable(note: ParsedNote) {
  return {
    links: note.links,
    tags: note.tags,
    tasks: note.tasks,
    headings: note.headings.map((heading) => ({ ...heading, text: squash(heading.text) })),
    plainText: squash(note.plainText),
  };
}

/** Fast result, or null when the fast scanner hands the note to the full parser. */
function fastParse(content: string): ParsedNote | null {
  try {
    return parseNoteUsing(content, fastNoteStructure);
  } catch (error) {
    if (error instanceof FullParseRequired) return null;
    throw error;
  }
}

describe('fast scanner equals the full parser on the fixture corpus (F4.2)', () => {
  for (const name of fixtureNames()) {
    it(name, () => {
      for (const { label, content } of fixtureVariants(readFixture(name))) {
        const full = parseNoteUsing(content, mdastNoteStructure);
        const fast = fastParse(content);
        expect(fast, label).not.toBeNull();
        expect(comparable(fast as ParsedNote), label).toEqual(comparable(full));
      }
    });
  }
});

describe('fast scanner equals the full parser on generated adversarial Markdown', () => {
  for (const seed of [1, 2, 3]) {
    it(`seed ${seed}: 600 documents`, () => {
      const random = createRandom(seed);
      let compared = 0;
      for (let i = 0; i < 600; i += 1) {
        const content = fuzzDocument(random);
        const fast = fastParse(content);
        if (!fast) continue;
        compared += 1;
        const full = parseNoteUsing(content, mdastNoteStructure);
        expect(comparable(fast), JSON.stringify(content)).toEqual(comparable(full));
      }
      expect(compared).toBeGreaterThan(500);
    });
  }
});

describe('fallback to the full parser', () => {
  it('is only used for named character references the fast scanner does not know', () => {
    for (const content of ['Caf&eacutex; [[C]]', '&ThinSpace; [[D]] [x](y.md)']) {
      expect(fastParse(content)).toBeNull();
      expect(parseNote(content)).toEqual(parseNoteUsing(content, mdastNoteStructure));
    }
  });

  it('is not needed for definitions, footnotes, URL literals or common entities', () => {
    for (const content of [
      '[ref]: ../a.md\n\nSee [x][ref] [[A]] and [ref] and [ref][]',
      'Note[^1] and [^2]\n\n[^1]: Footnote with [[B]]\n    - [ ] task 📅 2026-10-20',
      'https://x.com/[a](b.md) [[D]] www.e.com/`c` and (https://q.com)[t](u.md)',
      '[[Giải tích 1]]: môn học &amp; &lt;bài&gt; &#35; &mdash; &eacute; &rsquo;',
    ]) {
      const fast = fastParse(content);
      expect(fast).not.toBeNull();
      expect(comparable(fast as ParsedNote)).toEqual(
        comparable(parseNoteUsing(content, mdastNoteStructure)),
      );
    }
  });
});
