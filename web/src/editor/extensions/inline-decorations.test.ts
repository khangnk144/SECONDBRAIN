import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchUi } from '../../lib/search-ui-store';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { loadMarkdown, saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  placeCaret,
  pressKey,
  typeText,
  type TestEditor,
} from '../__tests__/editor-test-utils';
import { scanInlineTokens } from './inline-tokens';

let current: TestEditor | null = null;

function tagsIn(markdown: string): string[] {
  const paragraph = loadMarkdown(markdown).doc.firstChild!;
  return scanInlineTokens(paragraph, 1).flatMap((t) => (t.kind === 'tag' ? [t.tag] : []));
}

function chips(t: TestEditor): { text: string; className: string; title: string }[] {
  return [...t.view.dom.querySelectorAll<HTMLElement>('.date-chip')].map((el) => ({
    text: el.textContent ?? '',
    className: el.className,
    title: el.title,
  }));
}

describe('tag scanning mirrors the server rules (F6)', () => {
  it.each([
    ['#đồ-án mở đầu', ['đồ-án']],
    ['xem #môn/giải-tích/ và (#ghi_chú)', ['môn/giải-tích', 'ghi_chú']],
    ['số #1 không phải thẻ, a#b cũng không', []],
    ['`#mã` và [liên kết](#phần) và [[Ghi chú]]#sau', []],
    ['NFD #đồ-án', ['đồ-án']],
  ])('%s', (markdown, expected) => {
    expect(tagsIn(markdown)).toEqual(expected);
  });
});

describe('tag pills and date chips', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0));
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
    vi.useRealTimers();
  });

  it('draws tags as pills, never inside code', () => {
    current = createTestEditor('Thẻ #đồ-án và `#mã`\n\n```\n#trong-code\n```\n');
    const pills = [...current.view.dom.querySelectorAll('.tag-pill')].map((el) => el.textContent);
    expect(pills).toEqual(['#đồ-án']);
  });

  it('colours due dates by urgency on local calendar days, with relative text (F9)', () => {
    current = createTestEditor(
      [
        '- [ ] Mai 📅 2026-10-20',
        '- [ ] Năm ngày 📅 2026-10-24',
        '- [ ] Xa 📅 2026-11-05',
        '- [ ] Trễ 📅 2026-10-18',
        '- [ ] Sai 📅 2026-02-30',
        '- [x] Xong 📅 2026-10-18 ✅ 2026-10-17',
        '',
      ].join('\n'),
    );
    expect(chips(current)).toEqual([
      { text: '📅 2026-10-20', className: 'date-chip date-chip--urgent', title: 'Hạn ngày mai' },
      { text: '📅 2026-10-24', className: 'date-chip date-chip--soon', title: 'Còn 5 ngày' },
      { text: '📅 2026-11-05', className: 'date-chip date-chip--ok', title: 'Còn 17 ngày' },
      { text: '📅 2026-10-18', className: 'date-chip date-chip--urgent', title: 'Quá hạn 1 ngày' },
      {
        text: '📅 2026-02-30',
        className: 'date-chip date-chip--invalid',
        title: 'Ngày 2026-02-30 không có thật, nên không được tính.',
      },
      { text: '📅 2026-10-18', className: 'date-chip date-chip--done', title: 'Quá hạn 1 ngày' },
      {
        text: '✅ 2026-10-17',
        className: 'date-chip date-chip--done',
        title: 'Xong ngày 17/10/2026',
      },
    ]);
  });

  it('writes the relative text next to each open due date, outside the document (design §8)', () => {
    const source = [
      '- [ ] Mai 📅 2026-10-20',
      '- [ ] Năm ngày 📅 2026-10-24',
      '- [ ] Trễ 📅 2026-10-18 rồi',
      '- [ ] Sai 📅 2026-02-30',
      '- [x] Xong 📅 2026-10-18 ✅ 2026-10-17',
      '',
    ].join('\n');
    current = createTestEditor(source);
    const labels = [...current.view.dom.querySelectorAll<HTMLElement>('.date-chip__when')];
    expect(labels.map((el) => [el.textContent, el.classList[1]])).toEqual([
      ['ngày mai', 'date-chip__when--urgent'],
      ['còn 5 ngày', 'date-chip__when--soon'],
      ['quá hạn 1 ngày', 'date-chip__when--urgent'],
      ['ngày không có thật', 'date-chip__when--invalid'],
    ]);
    // Right after its chip, visible text (no hover needed), and never part of the note.
    expect(labels[2]!.previousElementSibling).toHaveClass('date-chip');
    expect(labels[2]).toHaveAttribute('contenteditable', 'false');
    expect(current.editor.state.doc.textContent).not.toContain('quá hạn');
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(source);
  });

  it('re-scans only what changed: typing a tag adds a pill, a code mark removes it', () => {
    current = createTestEditor('Một đoạn.\n\nĐoạn khác #cũ.\n');
    placeCaret(current.editor, 'Một đoạn');
    typeText(current.editor, ' #mới');
    const pills = () =>
      [...current!.view.dom.querySelectorAll('.tag-pill')].map((e) => e.textContent);
    expect(pills()).toEqual(['#mới', '#cũ']);
    current.editor.commands.setTextSelection({ from: 1, to: 1 + 'Một đoạn #mới'.length });
    current.editor.commands.toggleCode();
    expect(pills()).toEqual(['#cũ']);
  });

  it('recomputes urgency when the local day changes', () => {
    current = createTestEditor('- [ ] Việc 📅 2026-10-22\n');
    expect(chips(current)[0]!.className).toContain('date-chip--soon');
    vi.advanceTimersByTime(15 * 3_600_000 + 2_000); // 09:00 → just past midnight
    expect(chips(current)[0]!.className).toContain('date-chip--urgent');
    expect(chips(current)[0]!.title).toBe('Còn 2 ngày');
    expect(current.view.dom.querySelector('.date-chip__when')).toHaveTextContent('còn 2 ngày');
  });

  it('a click on a pill opens the search filtered by that tag (F6.3)', () => {
    current = createTestEditor('Xem #môn/giải-tích nhé\n');
    const view = current.view;
    const pos = 1 + 'Xem #mô'.length;
    const event = new MouseEvent('click', { button: 0 });
    const handled = view.someProp('handleClick', (f) => f(view, pos, event));
    expect(handled).toBe(true);
    expect(useSearchUi.getState()).toMatchObject({ open: true, query: 'tag:môn/giải-tích' });
  });

  it('Ctrl+Enter with the caret in a tag opens the same search', () => {
    current = createTestEditor('Xem #đồ-án nhé\n');
    placeCaret(current.editor, '#đồ');
    expect(pressKey(current.editor, 'Enter', { ctrl: true })).toBe(true);
    expect(useSearchUi.getState().query).toBe('tag:đồ-án');
  });
});
