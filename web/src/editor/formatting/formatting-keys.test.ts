import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { createTestEditor, placeCaret, type TestEditor } from '../__tests__/editor-test-utils';
import { saveMarkdown } from '../markdown/markdown-document';
import { FORMATTING_COMMANDS } from './formatting-commands';
import { editorKeyBindings, keymapName } from './formatting-keys';

let current: TestEditor | null = null;
beforeAll(installRangeLayoutShim);
afterEach(() => {
  current?.editor.destroy();
  current = null;
  vi.restoreAllMocks();
});

/** A keydown the way a US keyboard sends it: `key` is the produced character, `code` the key. */
function press(t: TestEditor, keys: string): boolean {
  const parts = keys.split('+');
  const base = parts.pop() as string;
  const shift = parts.includes('Shift');
  const shifted: Record<string, string> = { '7': '&', '8': '*', '9': '(' };
  const key = shift ? (shifted[base] ?? base.toUpperCase()) : base.toLowerCase();
  const event = new KeyboardEvent('keydown', {
    key,
    code: /^\d$/.test(base) ? `Digit${base}` : `Key${base.toUpperCase()}`,
    keyCode: base === '\\' ? 220 : base.toUpperCase().charCodeAt(0),
    ctrlKey: parts.includes('Ctrl'),
    altKey: parts.includes('Alt'),
    shiftKey: shift,
    bubbles: true,
    cancelable: true,
  });
  // ProseMirror prevents the default of every key a handler takes (true).
  return t.view.someProp('handleKeyDown', (handle) => handle(t.view, event)) ?? false;
}

function selectWord(t: TestEditor, word: string): void {
  placeCaret(t.editor, word, 'before');
  const { from } = t.editor.state.selection;
  const { state } = t.editor;
  t.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, from + word.length)));
}

describe('Word shortcuts in the editor', () => {
  it('writes registry keys in keymap notation', () => {
    expect(keymapName('Ctrl+Shift+S')).toBe('Mod-Shift-s');
    expect(keymapName('Ctrl+Alt+0')).toBe('Mod-Alt-0');
    expect(keymapName('Ctrl+\\')).toBe('Mod-\\');
    expect(editorKeyBindings().map((binding) => binding.keys)).not.toContain('Alt+S');
  });

  it.each(
    editorKeyBindings()
      .filter(({ command }) => !['undo', 'redo'].includes(command.id))
      .map(({ keys, command }) => [keys, command.id] as const),
  )('%s runs the same command as its button (%s)', (keys, id) => {
    const command = FORMATTING_COMMANDS.find((candidate) => candidate.id === id)!;
    // Each command where it applies: a style needs a block of another style.
    current = createTestEditor(id === 'paragraph' ? '## Một chữ đậm.\n' : 'Một chữ đậm.\n');
    selectWord(current, 'chữ');
    if (id === 'clearFormatting') current.editor.commands.setBold();
    const runs = vi.spyOn(command, 'run');
    expect(press(current, keys)).toBe(true);
    expect(runs).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z undo and redo', () => {
    current = createTestEditor('Một chữ.\n');
    selectWord(current, 'chữ');
    press(current, 'Ctrl+U');
    const saved = () => saveMarkdown(current!.editor.state.doc, current!.loaded.snapshot);
    expect(saved()).toBe('Một <u>chữ</u>.\n');
    press(current, 'Ctrl+Z');
    expect(saved()).toBe('Một chữ.\n');
    press(current, 'Ctrl+Y');
    expect(saved()).toBe('Một <u>chữ</u>.\n');
    press(current, 'Ctrl+Z');
    press(current, 'Ctrl+Shift+Z');
    expect(saved()).toBe('Một <u>chữ</u>.\n');
  });

  it('Ctrl+Alt+1…3 apply a heading (pressing again keeps it), Ctrl+Alt+0 goes back', () => {
    current = createTestEditor('Tiêu đề\n');
    placeCaret(current.editor, 'Tiêu');
    const saved = () => saveMarkdown(current!.editor.state.doc, current!.loaded.snapshot);
    press(current, 'Ctrl+Alt+2');
    press(current, 'Ctrl+Alt+2');
    expect(saved()).toBe('## Tiêu đề\n');
    press(current, 'Ctrl+Alt+0');
    expect(saved()).toBe('Tiêu đề\n');
  });

  it('a bound key that cannot apply is still taken, so the browser default never runs', () => {
    current = createTestEditor('```\ncode\n```\n');
    placeCaret(current.editor, 'code');
    const before = current.editor.state.doc;
    expect(press(current, 'Ctrl+U')).toBe(true);
    expect(current.editor.state.doc).toBe(before);
  });
});
