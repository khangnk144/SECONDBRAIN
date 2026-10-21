import { TextSelection } from '@tiptap/pm/state';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DialogHost } from '../../features/dialogs/dialog-host';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { createTestEditor, placeCaret, type TestEditor } from '../__tests__/editor-test-utils';
import { saveMarkdown } from '../markdown/markdown-document';
import { applyWebLink, editWebLinkWithDialog, normalizeWebAddress } from './web-link';

let current: TestEditor | null = null;
beforeAll(installRangeLayoutShim);
beforeEach(async () => {
  await resetAppState();
});
afterEach(() => {
  current?.editor.destroy();
  current = null;
});

function selectWord(t: TestEditor, word: string): void {
  placeCaret(t.editor, word, 'before');
  const { from } = t.editor.state.selection;
  const { state } = t.editor;
  t.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, from + word.length)));
}

const saved = (t: TestEditor) => saveMarkdown(t.editor.state.doc, t.loaded.snapshot);

describe('web links', () => {
  it.each([
    ['  https://vi.wikipedia.org  ', 'https://vi.wikipedia.org'],
    ['www.example.com/a', 'https://www.example.com/a'],
    ['tai-lieu.md', 'tai-lieu.md'],
    ['', ''],
    ['https://a b', null],
  ])('normalizes %j → %j', (input, expected) => {
    expect(normalizeWebAddress(input)).toBe(expected);
  });

  it('links a selection, edits the whole link from inside it, removes it with an empty address', () => {
    current = createTestEditor('Xem Wikipedia nhé.\n');
    selectWord(current, 'Wikipedia');
    applyWebLink(current.editor, 'https://vi.wikipedia.org');
    expect(saved(current)).toBe('Xem [Wikipedia](https://vi.wikipedia.org) nhé.\n');
    placeCaret(current.editor, 'Wiki');
    applyWebLink(current.editor, 'https://en.wikipedia.org');
    expect(saved(current)).toBe('Xem [Wikipedia](https://en.wikipedia.org) nhé.\n');
    applyWebLink(current.editor, '');
    expect(saved(current)).toBe('Xem Wikipedia nhé.\n');
  });

  it('a caret outside any link inserts the address as linked text', () => {
    current = createTestEditor('Xem  nhé\n');
    placeCaret(current.editor, 'Xem ');
    applyWebLink(current.editor, 'https://e.com/a_b');
    expect(saved(current)).toBe('Xem <https://e.com/a_b> nhé\n');
  });

  it('asks for the address in a dialog that shows the current one', async () => {
    render(<DialogHost />);
    current = createTestEditor('Xem [trang](https://cu.vn) này.\n');
    placeCaret(current.editor, 'tra');
    let done: Promise<void> = Promise.resolve();
    act(() => {
      done = editWebLinkWithDialog(current!.editor);
    });
    const field = screen.getByRole('textbox', { name: /Địa chỉ web/ });
    expect(field).toHaveValue('https://cu.vn');
    fireEvent.change(field, { target: { value: 'có dấu cách' } });
    fireEvent.click(screen.getByRole('button', { name: 'Lưu liên kết' }));
    expect(screen.getByRole('alert')).toHaveTextContent('không có dấu cách');
    fireEvent.change(field, { target: { value: 'www.moi.vn' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Lưu liên kết' }));
      await done;
    });
    expect(saved(current)).toBe('Xem [trang](https://www.moi.vn) này.\n');
  });
});
