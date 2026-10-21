import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installRangeLayoutShim } from '../__tests__/jsdom-layout';
import { createTestEditor, placeCaret, type TestEditor } from '../__tests__/editor-test-utils';
import { activeTrigger } from '../extensions/editor-triggers';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  editorOnlyContext,
  FORMATTING_COMMANDS,
  formattingCommand,
  type FormattingContext,
} from './formatting-commands';

let current: TestEditor | null = null;
beforeAll(installRangeLayoutShim);

function open(source: string): TestEditor {
  current = createTestEditor(source);
  return current;
}

afterEach(() => {
  current?.editor.destroy();
  current = null;
});

function select(t: TestEditor, text: string): void {
  let from = -1;
  t.editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text)) {
      from = pos + (node.text?.indexOf(text) ?? 0);
    }
    return from === -1;
  });
  if (from === -1) throw new Error(`text not found: ${text}`);
  const { state } = t.editor;
  t.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from, from + text.length)));
}

const context = (t: TestEditor): FormattingContext => editorOnlyContext(t.editor);
const run = (t: TestEditor, id: string) => formattingCommand(id).run(context(t));
const enabled = (t: TestEditor, id: string) => formattingCommand(id).isEnabled(context(t));
const saved = (t: TestEditor) => saveMarkdown(t.editor.state.doc, t.loaded.snapshot);

describe('formatting commands write canonical Markdown (P3)', () => {
  it.each([
    ['bold', '**chữ**'],
    ['italic', '*chữ*'],
    ['underline', '<u>chữ</u>'],
    ['strike', '~~chữ~~'],
    ['code', '`chữ`'],
  ])('%s on a selected word → %s', (id, expected) => {
    const t = open('Một chữ thôi.\n\nKhác.\n');
    select(t, 'chữ');
    run(t, id);
    expect(saved(t)).toBe(`Một ${expected} thôi.\n\nKhác.\n`);
    expect(formattingCommand(id).isActive?.(context(t))).toBe(true);
  });

  it.each([
    ['heading1', '# Đoạn'],
    ['heading2', '## Đoạn'],
    ['heading3', '### Đoạn'],
    ['bulletList', '- Đoạn'],
    ['orderedList', '1. Đoạn'],
    ['taskList', '- [ ] Đoạn'],
    ['blockquote', '> Đoạn'],
    ['codeBlock', '```\nĐoạn\n```'],
  ])('%s on a paragraph → %j', (id, expected) => {
    const t = open('Trước.\n\nĐoạn\n\nSau.\n');
    placeCaret(t.editor, 'Đoạn');
    run(t, id);
    expect(saved(t)).toBe(`Trước.\n\n${expected}\n\nSau.\n`);
    expect(formattingCommand(id).isActive?.(context(t))).toBe(true);
  });

  it('paragraph style turns a heading back into text; a style applied twice stays', () => {
    const t = open('## Tiêu đề\n');
    placeCaret(t.editor, 'Tiêu');
    run(t, 'heading2');
    expect(saved(t)).toBe('## Tiêu đề\n');
    run(t, 'paragraph');
    expect(saved(t)).toBe('Tiêu đề\n');
  });

  it('inserts a divider and a table as their own blocks', () => {
    const t = open('Đầu\n');
    placeCaret(t.editor, 'Đầu');
    run(t, 'divider');
    expect(saved(t)).toMatch(/^Đầu\n\n---\n/);
    const u = open('Đầu\n');
    placeCaret(u.editor, 'Đầu');
    run(u, 'table');
    expect(saved(u)).toMatch(/^Đầu\n\n\| +\| +\|\n\| -+ \| -+ \|/);
  });

  it('clears character formatting and keeps links', () => {
    const t = open('A ***<u>đậm</u>*** và [**web**](https://e.com) z\n');
    select(t, 'đậm');
    expect(enabled(t, 'clearFormatting')).toBe(true);
    run(t, 'clearFormatting');
    select(t, 'web');
    run(t, 'clearFormatting');
    expect(saved(t)).toBe('A đậm và [web](https://e.com) z\n');
    expect(enabled(t, 'clearFormatting')).toBe(false);
  });

  it('note link types `[[` after the selection and opens the note suggestions', () => {
    const t = open('Xem ghi chú\n');
    select(t, 'ghi');
    run(t, 'noteLink');
    expect(t.editor.state.doc.textContent).toBe('Xem ghi[[ chú');
    expect(activeTrigger(t.editor.state)?.kind).toBe('wikilink');
  });

  it('undo and redo step through the edits', () => {
    const t = open('Một chữ.\n');
    expect(enabled(t, 'undo')).toBe(false);
    select(t, 'chữ');
    run(t, 'bold');
    expect(enabled(t, 'undo')).toBe(true);
    run(t, 'undo');
    expect(saved(t)).toBe('Một chữ.\n');
    run(t, 'redo');
    expect(saved(t)).toBe('Một **chữ**.\n');
  });
});

describe('formatting commands are disabled where they cannot apply', () => {
  const editorCommands = FORMATTING_COMMANDS.filter(
    (command) => !['undo', 'redo', 'sourceMode'].includes(command.id),
  );

  it('everything on a selected verbatim block', () => {
    const t = open('Đoạn\n\n#### Mục cấp 4\n');
    t.view.dispatch(t.editor.state.tr.setSelection(NodeSelection.create(t.editor.state.doc, 6)));
    expect(t.editor.state.selection instanceof NodeSelection).toBe(true);
    for (const command of editorCommands) expect(enabled(t, command.id), command.id).toBe(false);
  });

  it('inside a code block only the way out (paragraph, code block) stays', () => {
    const t = open('```js\nlet x = 1;\n```\n');
    placeCaret(t.editor, 'let');
    const on = editorCommands.filter((command) => enabled(t, command.id)).map((c) => c.id);
    expect(on).toEqual(['paragraph', 'codeBlock']);
  });

  it('in a table cell marks and links work, block commands do not', () => {
    const t = open('| a | b |\n| - | - |\n| ô | d |\n');
    select(t, 'ô');
    const on = editorCommands.filter((command) => enabled(t, command.id)).map((c) => c.id);
    expect(on).toEqual(['bold', 'italic', 'underline', 'strike', 'code', 'webLink', 'noteLink']);
  });

  it('in source mode only undo, redo and the source switch', () => {
    const t = open('Đoạn\n');
    const source = { ...context(t), sourceMode: true, canToggleSource: true };
    const on = FORMATTING_COMMANDS.filter((command) => command.isEnabled(source));
    expect(on.map((command) => command.id)).toEqual(['undo', 'redo', 'sourceMode']);
  });

  it('a read-only note (not UTF-8) takes no formatting at all', () => {
    const t = open('Đoạn\n');
    t.editor.setEditable(false);
    for (const command of editorCommands) expect(enabled(t, command.id), command.id).toBe(false);
  });
});
