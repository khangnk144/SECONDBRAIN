import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  placeCaret,
  pressKey,
  type TestEditor,
} from '../__tests__/editor-test-utils';

const SOURCE = [
  '---',
  'type: project',
  '---',
  '',
  '## Việc cần làm',
  '',
  '- [x] Chọn đề tài ✅ 2026-10-10',
  '- [ ] Nộp bản nháp 📅 2026-11-01',
  '- [ ] Nộp bản nháp 📅 2026-11-01',
  '',
  '> - [ ] Trong trích dẫn',
  '',
].join('\n');

let current: TestEditor | null = null;

function checkboxes(t: TestEditor): HTMLInputElement[] {
  return [...t.view.dom.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
}

function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  expect(b).toHaveLength(a.length);
  return b.filter((line, i) => line !== a[i]);
}

describe('task checkboxes (F9 look, tick patch)', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 23, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
    current?.editor.destroy();
    current = null;
  });

  it('renders real round checkboxes labelled by the task text', () => {
    current = createTestEditor(SOURCE);
    const boxes = checkboxes(current);
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    expect(boxes[1]).toHaveAccessibleName('Xong việc: Nộp bản nháp 📅 2026-11-01');
    expect(boxes[0]!.closest('li')).toHaveAttribute('data-checked', 'true');
  });

  it('ticking appends today (local date) and saves as a one-line patch', () => {
    current = createTestEditor(SOURCE);
    fireEvent.click(checkboxes(current)[2]!);
    const saved = saveMarkdown(current.editor.state.doc, current.loaded.snapshot);
    expect(changedLines(SOURCE, saved)).toEqual(['- [x] Nộp bản nháp 📅 2026-11-01 ✅ 2026-10-19']);
    // The twin task on the line above is untouched (line identity, not text identity).
    expect(saved.split('\n')[7]).toBe('- [ ] Nộp bản nháp 📅 2026-11-01');
  });

  it('unticking removes the done token and restores the original bytes', () => {
    current = createTestEditor(SOURCE);
    fireEvent.click(checkboxes(current)[0]!);
    const saved = saveMarkdown(current.editor.state.doc, current.loaded.snapshot);
    expect(changedLines(SOURCE, saved)).toEqual(['- [ ] Chọn đề tài']);
    fireEvent.click(checkboxes(current)[0]!);
    expect(
      changedLines(SOURCE, saveMarkdown(current.editor.state.doc, current.loaded.snapshot)),
    ).toEqual(['- [x] Chọn đề tài ✅ 2026-10-19']);
  });

  it('works inside a quote and with CRLF line ends', () => {
    const crlf = SOURCE.replaceAll('\n', '\r\n');
    current = createTestEditor(crlf);
    fireEvent.click(checkboxes(current)[3]!);
    const saved = saveMarkdown(current.editor.state.doc, current.loaded.snapshot);
    expect(saved).toBe(
      crlf.replace('> - [ ] Trong trích dẫn', '> - [x] Trong trích dẫn ✅ 2026-10-19'),
    );
  });

  it('a tick is one undo step', () => {
    current = createTestEditor(SOURCE);
    fireEvent.click(checkboxes(current)[1]!);
    current.editor.commands.undo();
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(SOURCE);
  });

  it('Mod+Enter ticks the task holding the caret', () => {
    current = createTestEditor(SOURCE);
    placeCaret(current.editor, 'Trong trích');
    expect(pressKey(current.editor, 'Enter', { ctrl: true })).toBe(true);
    expect(checkboxes(current)[3]).toBeChecked();
  });

  it('read-only notes keep their checkboxes disabled and unchanged', () => {
    current = createTestEditor(SOURCE, { editable: false });
    const box = checkboxes(current)[1]!;
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(saveMarkdown(current.editor.state.doc, current.loaded.snapshot)).toBe(SOURCE);
  });
});
