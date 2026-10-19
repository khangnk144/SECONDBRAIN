import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useWritingFocus } from '../../lib/writing-focus-store';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  placeCaret,
  pressKey,
  typeText,
  type TestEditor,
} from '../__tests__/editor-test-utils';

let current: TestEditor | null = null;

describe('verbatim blocks (F3.2 in the editor)', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('show their raw text read-only with a "nguồn" badge and survive edits elsewhere', () => {
    const source = 'Đoạn đầu.\n\n#### Tiêu đề cấp 4\n\n$$\nx^2\n$$\n';
    current = createTestEditor(source);
    const blocks = [...current.view.dom.querySelectorAll<HTMLElement>('.verbatim-block')];
    expect(blocks.map((b) => b.querySelector('pre')?.textContent)).toEqual([
      '#### Tiêu đề cấp 4',
      '$$\nx^2\n$$',
    ]);
    expect(blocks[0]).toHaveAttribute('contenteditable', 'false');
    const badge = blocks[0]!.querySelector('.verbatim-block__badge');
    expect(badge).toHaveTextContent('nguồn');
    expect(badge).toHaveAttribute('title', 'Sửa đoạn này trong chế độ nguồn (Alt+S)');
    placeCaret(current.editor, 'Đoạn đầu');
    typeText(current.editor, ' mới');
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(
      source.replace('Đoạn đầu.', 'Đoạn đầu mới.'),
    );
  });
});

describe('the end of the document', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('a click under a final table opens a new line; nothing is added before that', () => {
    const source = 'Đoạn.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n';
    current = createTestEditor(source);
    current.editor.commands.setTextSelection(3);
    expect(current.editor.state.doc.lastChild!.type.name).toBe('table');
    const { view } = current;
    const event = new MouseEvent('click', { clientY: 500 });
    Object.defineProperty(event, 'target', { value: view.dom });
    expect(view.someProp('handleClick', (f) => f(view, 0, event))).toBe(true);
    typeText(current.editor, 'Tiếp');
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(
      `${source}\nTiếp\n`,
    );
  });
});

describe('table cells hold one line', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('Enter moves to the cell below, adding a row at the bottom', () => {
    current = createTestEditor('| Môn | Điểm |\n| --- | --- |\n| Toán | 9 |\n');
    placeCaret(current.editor, 'Môn');
    expect(pressKey(current.editor, 'Enter')).toBe(true);
    expect(current.editor.state.selection.$from.parent.textContent).toBe('Toán');
    expect(pressKey(current.editor, 'Enter')).toBe(true);
    const table = current.editor.state.doc.firstChild!;
    expect(table.childCount).toBe(3);
    typeText(current.editor, 'Lý');
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(
      // A changed table is written in the canonical (aligned) style.
      '| Môn  | Điểm |\n| ---- | ---- |\n| Toán | 9    |\n| Lý   |      |\n',
    );
  });
});

describe('focus mode (F3)', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 9, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    current?.editor.destroy();
    current = null;
  });

  function typeFor(ms: number, gapMs: number) {
    for (let elapsed = 0; elapsed <= ms; elapsed += gapMs) {
      pressKey(current!.editor, 'a');
      vi.setSystemTime(Date.now() + gapMs);
    }
  }

  it('fades the side panes after 5 s of continuous typing, not before', () => {
    current = createTestEditor('x\n');
    typeFor(4_000, 300);
    expect(useWritingFocus.getState().focused).toBe(false);
    typeFor(1_500, 300);
    expect(useWritingFocus.getState().focused).toBe(true);
  });

  it('a pause starts the count again', () => {
    current = createTestEditor('x\n');
    typeFor(4_000, 300);
    vi.setSystemTime(Date.now() + 2_000);
    typeFor(3_000, 300);
    expect(useWritingFocus.getState().focused).toBe(false);
  });
});
