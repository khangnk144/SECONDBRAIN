import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, type TestEditor } from './__tests__/editor-test-utils';
import {
  hasMeaningfulSelection,
  selectionMarkdown,
  selectionPlainText,
} from './selection-markdown';

let current: TestEditor | null = null;

function editorWith(source: string) {
  current = createTestEditor(source);
  return current.editor;
}

/** Selects from the start of `start` to the end of `end` (both found in text nodes). */
function select(start: string, end = start) {
  const editor = current!.editor;
  let from = -1;
  let to = -1;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const text = node.text ?? '';
    if (from === -1 && text.includes(start)) from = pos + text.indexOf(start);
    if (text.includes(end)) to = pos + text.indexOf(end) + end.length;
    return true;
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)),
  );
}

afterEach(() => {
  current?.editor.destroy();
  current = null;
});

describe('selection as Markdown (AI actions send this)', () => {
  it('gives the selected words with their marks, never the block marks around them', () => {
    const editor = editorWith('## Đồ án **Giải tích** nhóm 3\n\nĐoạn khác.\n');
    select('án', 'nhóm');
    expect(selectionMarkdown(editor.state)).toBe('án **Giải tích** nhóm');
    expect(selectionPlainText(editor.state)).toBe('án Giải tích nhóm');
  });

  it('keeps wikilinks and tags as written', () => {
    const editor = editorWith('Xem [[Giải tích 1]] với #đồ-án nhé.\n');
    select('Xem', 'nhé.');
    expect(selectionMarkdown(editor.state)).toBe('Xem [[Giải tích 1]] với #đồ-án nhé.');
  });

  it('cuts blocks across a selection to what is selected, lists included', () => {
    const editor = editorWith('Mở đầu một.\n\n- việc một\n- việc hai\n- việc ba\n\nKết.\n');
    select('đầu', 'hai');
    expect(selectionMarkdown(editor.state)).toBe('đầu một.\n\n- việc một\n- việc hai');
  });

  it('a selection inside one list item keeps only its words', () => {
    const editor = editorWith('- [ ] Nộp bản nháp 📅 2026-11-01\n- [ ] Khác\n');
    select('bản', 'nháp');
    expect(selectionMarkdown(editor.state)).toBe('bản nháp');
  });

  it('sends the source of a selected verbatim block, and the text of a code block', () => {
    const editor = editorWith('Trước.\n\n$$\nx^2 + y^2\n$$\n\n```js\nconst a = 1;\n```\n');
    let verbatim = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === 'verbatimBlock') verbatim = offset;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, verbatim)),
    );
    expect(selectionMarkdown(editor.state)).toBe('$$\nx^2 + y^2\n$$');
    expect(hasMeaningfulSelection(editor.state)).toBe(true);
    select('const', '1;');
    expect(selectionMarkdown(editor.state)).toBe('const a = 1;');
  });

  it('an empty or blank selection counts as nothing', () => {
    const editor = editorWith('Một  hai.\n');
    expect(hasMeaningfulSelection(editor.state)).toBe(false);
    expect(selectionMarkdown(editor.state)).toBe('');
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 6)),
    );
    expect(hasMeaningfulSelection(editor.state)).toBe(false);
  });
});
