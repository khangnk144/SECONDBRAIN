import { undo } from '@tiptap/pm/history';
import { Fragment } from '@tiptap/pm/model';
import { TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { createTestEditor, typeText, type TestEditor } from './__tests__/editor-test-utils';
import {
  afterTopLevelBlock,
  closeHistoryStep,
  insertBlocksAt,
  linkListParagraph,
  markdownToBlocks,
  replaceRangeWithMarkdown,
} from './markdown-insert';
import { saveMarkdown } from './markdown/markdown-document';

const CRLF_SOURCE = [
  '---',
  'type: note   # giữ nguyên',
  '---',
  '# Bài 1',
  '',
  'Đoạn *một* có   hai khoảng trắng.',
  '',
  '- [ ] Nộp bài 📅 2026-11-01',
  '',
  '$$x^2$$',
  '',
  'Cuối _bài_.',
  '',
].join('\r\n');

let current: TestEditor | null = null;

afterEach(() => {
  current?.editor.destroy();
  current = null;
});

function setup(source = CRLF_SOURCE) {
  current = createTestEditor(source);
  const { editor, loaded } = current;
  const saved = () => saveMarkdown(editor.state.doc, loaded.snapshot);
  const apply = (build: (state: EditorState) => Transaction | null) => {
    const tr = build(editor.state);
    if (tr) editor.view.dispatch(tr);
    editor.view.dispatch(closeHistoryStep(editor.state));
  };
  const rangeOf = (text: string) => {
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from === -1 && node.isText && node.text?.includes(text)) {
        from = pos + node.text.indexOf(text);
      }
      return from === -1;
    });
    if (from === -1) throw new Error(`not found: ${text}`);
    return { from, to: from + text.length };
  };
  const undoOnce = () => undo(editor.state, (tr) => editor.view.dispatch(tr));
  return { editor, saved, apply, rangeOf, undoOnce };
}

describe('writing Markdown through the editor (AI insertions keep §4.9)', () => {
  it('inserts a quoted block after the selection’s block; every other byte stays', () => {
    const { editor, saved, apply, rangeOf, undoOnce } = setup();
    const { to } = rangeOf('hai khoảng');
    apply((state) =>
      insertBlocksAt(
        state,
        afterTopLevelBlock(state.doc, to),
        markdownToBlocks('> **Tóm tắt (AI):** Ý chính\n> - một\n> - hai', state.schema)!,
      ),
    );
    expect(saved()).toBe(
      CRLF_SOURCE.replace(
        'khoảng trắng.\r\n\r\n',
        'khoảng trắng.\r\n\r\n> **Tóm tắt (AI):** Ý chính\r\n>\r\n> - một\r\n> - hai\r\n\r\n',
      ),
    );
    // The caret ends after the insertion; one undo takes the whole insertion back.
    expect(editor.state.selection.from).toBeGreaterThan(to);
    expect(undoOnce()).toBe(true);
    expect(saved()).toBe(CRLF_SOURCE);
  });

  it('typing right after an insertion is its own undo step', () => {
    const { editor, saved, apply, rangeOf, undoOnce } = setup();
    const { to } = rangeOf('Cuối');
    apply((state) =>
      insertBlocksAt(
        state,
        afterTopLevelBlock(state.doc, to),
        markdownToBlocks('Mới.', state.schema)!,
      ),
    );
    typeText(editor, ' thêm');
    expect(undoOnce()).toBe(true);
    expect(saved()).toBe(`${CRLF_SOURCE}\r\nMới.\r\n`);
    expect(undoOnce()).toBe(true);
    expect(saved()).toBe(CRLF_SOURCE);
  });

  it('replaces words inside a paragraph inline, keeping the spaces around them', () => {
    const { saved, apply, rangeOf, undoOnce } = setup();
    const { from, to } = rangeOf('có   hai ');
    apply((state) => replaceRangeWithMarkdown(state, from, to, 'gồm **hai** '));
    expect(saved()).toBe(
      CRLF_SOURCE.replace('Đoạn *một* có   hai khoảng', 'Đoạn *một* gồm **hai** khoảng'),
    );
    expect(undoOnce()).toBe(true);
    expect(saved()).toBe(CRLF_SOURCE);
  });

  it('a rewrite of several blocks is fitted in like a paste; the verbatim block is untouched', () => {
    const { editor, saved, apply } = setup('Một.\n\nHai.\n\n$$x$$\n');
    apply((state) => replaceRangeWithMarkdown(state, 1, 11, 'Câu một.\n\nCâu hai.'));
    expect(editor.state.doc.childCount).toBe(3);
    expect(saved()).toBe('Câu một.\n\nCâu hai.\n\n$$x$$\n');
  });

  it('text put into a code block stays plain text', () => {
    const { saved, apply, rangeOf } = setup('```\nlet a = 1;\n```\n');
    const { from, to } = rangeOf('1');
    apply((state) => replaceRangeWithMarkdown(state, from, to, '**2**'));
    expect(saved()).toBe('```\nlet a = **2**;\n```\n');
  });

  it('writes a link paragraph with title and path forms', () => {
    const { saved, apply, rangeOf } = setup('Đoạn văn.\n\nKhác.\n');
    const { to } = rangeOf('văn');
    apply((state) =>
      insertBlocksAt(
        state,
        afterTopLevelBlock(state.doc, to),
        Fragment.from(
          linkListParagraph(state.schema, 'Liên quan:', ['Giải tích 1', '2 Areas/Bài 1']),
        ),
      ),
    );
    expect(saved()).toBe('Đoạn văn.\n\nLiên quan: [[Giải tích 1]], [[2 Areas/Bài 1]]\n\nKhác.\n');
  });

  it('blank Markdown inserts nothing; a leading --- is text, not front matter', () => {
    const { editor } = setup('A.\n');
    expect(markdownToBlocks('  \n ', editor.schema)).toBeNull();
    const blocks = markdownToBlocks('---\nkhông phải YAML\n---', editor.schema);
    expect(blocks?.textBetween(0, blocks.size, '\n')).toContain('không phải YAML');
    expect(replaceRangeWithMarkdown(editor.state, 1, 2, '   ')).toBeNull();
  });

  it('a selection that ends between blocks inserts right there', () => {
    const { editor } = setup('A.\n\nB.\n');
    const between = editor.state.doc.child(0).nodeSize;
    expect(afterTopLevelBlock(editor.state.doc, between)).toBe(between);
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 1, 2)),
    );
    expect(afterTopLevelBlock(editor.state.doc, editor.state.selection.to)).toBe(between);
  });
});
