import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  placeCaret,
  pressKey,
  type TestEditor,
} from '../__tests__/editor-test-utils';

let current: TestEditor | null = null;

function saved(t: TestEditor): string {
  return saveMarkdown(t.editor.state.doc, t.loaded.snapshot);
}

describe('Tab and Shift+Tab in lists', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('Tab nests a list item under the one above, Shift+Tab brings it back', () => {
    current = createTestEditor('- một\n- hai\n- ba\n');
    placeCaret(current.editor, 'hai');
    expect(pressKey(current.editor, 'Tab')).toBe(true);
    expect(saved(current)).toBe('- một\n  - hai\n- ba\n');
    expect(pressKey(current.editor, 'Tab', { shift: true })).toBe(true);
    expect(saved(current)).toBe('- một\n- hai\n- ba\n');
  });

  it('works for task items too', () => {
    current = createTestEditor('- [ ] Đọc đề\n- [ ] Lập dàn ý\n');
    placeCaret(current.editor, 'Lập');
    expect(pressKey(current.editor, 'Tab')).toBe(true);
    expect(saved(current)).toBe('- [ ] Đọc đề\n  - [ ] Lập dàn ý\n');
  });

  it('Tab on an item that cannot go deeper is kept in the editor and changes nothing', () => {
    current = createTestEditor('- một\n- hai\n');
    placeCaret(current.editor, 'một');
    expect(pressKey(current.editor, 'Tab')).toBe(true);
    expect(saved(current)).toBe('- một\n- hai\n');
  });

  it('outside lists Tab is left to the browser (focus moves on), in tables it goes to the next cell', () => {
    current = createTestEditor('Đoạn văn.\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n');
    placeCaret(current.editor, 'Đoạn');
    expect(pressKey(current.editor, 'Tab')).toBe(false);
    expect(pressKey(current.editor, 'Tab', { shift: true })).toBe(false);
    placeCaret(current.editor, '1');
    expect(pressKey(current.editor, 'Tab')).toBe(true);
    expect(current.editor.state.selection.$from.parent.textContent).toBe('2');
  });
});
