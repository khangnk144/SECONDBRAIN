import { describe, expect, it } from 'vitest';
import {
  continuesAfterFirstLine,
  findTaskParagraph,
  renderTaskParagraph,
} from '../../src/markdown/task-paragraph.js';

/** Rendering of the task paragraph of a one-task note; `marks` are the token emojis to drop. */
function render(content: string, ...emojis: string[]): string | null {
  const checkbox = content.indexOf('[');
  const paragraph = findTaskParagraph(content, 0, checkbox);
  if (!paragraph) throw new Error('no task paragraph');
  const marks = emojis.map((emoji) => content.indexOf(emoji));
  return renderTaskParagraph(content, paragraph, marks);
}

describe('the task paragraph from the block structure', () => {
  it.each([
    ['> - [ ] Đọc chương 3\\\n>       rồi tóm tắt\n', true],
    ['- [ ] a\\\n  <u>b</u>\n', true],
    ['- [ ] a\\\n  2. b\n', true],
    ['- [ ] a\\\nlazy\n', true],
    ['- [ ] a\\\n  - b\n', false],
    ['- [ ] a\\\n\n  b\n', false],
    ['> - [ ] a\\\n> > b\n', false],
    ['- [ ] a\\\n  ```\n  x\n  ```\n', false],
  ])('%j goes on after the checkbox line: %s', (content, continues) => {
    const paragraph = findTaskParagraph(content, 0, content.indexOf('['));
    expect(paragraph).not.toBeNull();
    expect(continuesAfterFirstLine(paragraph!)).toBe(continues);
  });
});

describe('rendering check used to refuse a patch (patch-verify)', () => {
  it('a token after a hard-break backslash shows a literal backslash: different', () => {
    const before = render('- [ ] a\\\n  <u>b</u>\n');
    expect(render('- [x] a ✅ 2026-10-20\\\n  <u>b</u>\n', '✅')).toBe(before);
    expect(render('- [x] a\\ ✅ 2026-10-20\n  <u>b</u>\n', '✅')).not.toBe(before);
  });

  it('the same in a quote, where the next line starts with ">"', () => {
    const before = render('> - [ ] Đọc chương 3\\\n>       rồi tóm tắt\n');
    expect(render('> - [x] Đọc chương 3 ✅ 2026-10-20\\\n>       rồi tóm tắt\n', '✅')).toBe(
      before,
    );
    expect(render('> - [x] Đọc chương 3\\ ✅ 2026-10-20\n>       rồi tóm tắt\n', '✅')).not.toBe(
      before,
    );
  });

  it('blanks left before a soft line break make it a hard one: different', () => {
    const before = render('- [x] a   ✅ 2026-10-19\n  b\n', '✅');
    expect(render('- [ ] a\n  b\n')).toBe(before);
    expect(render('- [ ] a  \n  b\n')).not.toBe(before);
  });

  it('only the marked token is left out; any other change counts', () => {
    const before = render('- [ ] xem [[Họp 📅 2026-10-22]] nhé 📅 2026-10-23\n', '📅 2026-10-23');
    expect(render('- [ ] xem [[Họp 📅 2026-10-22]] nhé 📅 2026-10-25\n', '📅 2026-10-25')).toBe(
      before,
    );
    expect(render('- [ ] xem [[Họp 📅 2026-10-25]] nhé 📅 2026-10-23\n', '📅 2026-10-23')).not.toBe(
      before,
    );
  });

  it('honours the note definitions: a broken reference link is different', () => {
    const tail = '\n\n[đề cương]: https://example.com\n';
    const before = render(`- [ ] xem [đề\n  cương] nhé${tail}`);
    expect(render(`- [x] xem [đề ✅ 2026-10-20\n  cương] nhé${tail}`, '✅')).not.toBe(before);
  });

  it('a mark that is not on a token emoji gives no rendering', () => {
    const content = '- [ ] a 📅 2026-10-22\n';
    const paragraph = findTaskParagraph(content, 0, 2)!;
    expect(renderTaskParagraph(content, paragraph, [content.indexOf('a')])).toBeNull();
  });
});
