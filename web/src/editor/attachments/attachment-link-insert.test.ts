import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import {
  createTestEditor,
  newLineAtEnd,
  placeCaret,
  type TestEditor,
} from '../__tests__/editor-test-utils';
import { buildLinkInsertion, linkNodeFor, wantsOwnLine } from './attachment-link-insert';

let current: TestEditor | null = null;

function open(source: string): TestEditor {
  current = createTestEditor(source);
  return current;
}

function insertAtCaret(editor: Editor, link: string): number {
  const { state } = editor;
  const pos = state.selection.from;
  const insertion = buildLinkInsertion(state, pos, link, wantsOwnLine(state, pos));
  if (!insertion) throw new Error('nothing inserted');
  editor.view.dispatch(insertion.tr);
  return insertion.after;
}

function saved(t: TestEditor): string {
  return saveMarkdown(t.editor.state.doc, t.loaded.snapshot);
}

describe('inserting an uploaded file link (F15.1)', () => {
  beforeEach(async () => {
    await resetAppState();
  });
  afterEach(() => {
    current?.editor.destroy();
    current = null;
  });

  it('reads the server link as a wikilink node, embed or not', () => {
    const t = open('A\n');
    expect(linkNodeFor(t.editor.state, '![[image 2.png]]').attrs).toMatchObject({
      target: 'image 2.png',
      embed: true,
    });
    expect(linkNodeFor(t.editor.state, '[[3 Resources/papers/bài 3.pdf]]').attrs).toMatchObject({
      target: '3 Resources/papers/bài 3.pdf',
      embed: false,
    });
    expect(linkNodeFor(t.editor.state, 'not a link').isText).toBe(true);
  });

  it('an image on an empty line becomes its own paragraph, nothing else changes', () => {
    const t = open('---\r\ntype: note # giữ\r\n---\r\nMở đầu  \r\n\r\n- [ ] việc\r\n');
    placeCaret(t.editor, 'Mở đầu');
    newLineAfterFirstBlock(t.editor);
    insertAtCaret(t.editor, '![[image.png]]');
    expect(saved(t)).toBe(
      '---\r\ntype: note # giữ\r\n---\r\nMở đầu  \r\n\r\n![[image.png]]\r\n\r\n- [ ] việc\r\n',
    );
  });

  it('inside text the link goes inline with the spaces it needs', () => {
    const t = open('Xem tàiliệu nhé\n');
    placeCaret(t.editor, 'Xem tài');
    insertAtCaret(t.editor, '[[bài giảng 3.pdf]]');
    expect(saved(t)).toBe('Xem tài [[bài giảng 3.pdf]] liệu nhé\n');
    const u = open('Xem nhé\n');
    placeCaret(u.editor, 'Xem ');
    insertAtCaret(u.editor, '[[a.pdf]]');
    expect(saved(u)).toBe('Xem [[a.pdf]] nhé\n');
  });

  it('later files of one drop on an empty line get paragraphs of their own, in order', () => {
    const t = open('A\n');
    newLineAtEnd(t.editor);
    const { state } = t.editor;
    const pos = state.selection.from;
    const first = buildLinkInsertion(state, pos, '![[a.png]]', true)!;
    t.editor.view.dispatch(first.tr);
    const second = buildLinkInsertion(t.editor.state, first.after, '![[b.png]]', true)!;
    t.editor.view.dispatch(second.tr);
    expect(saved(t)).toBe('A\n\n![[a.png]]\n\n![[b.png]]\n');
  });

  it('a drop between blocks or into a code block adds a paragraph instead', () => {
    const t = open('A\n\n```\ncode\n```\n');
    const afterFirst = t.editor.state.doc.child(0).nodeSize;
    const between = buildLinkInsertion(t.editor.state, afterFirst, '[[x.pdf]]', true)!;
    t.editor.view.dispatch(between.tr);
    expect(saved(t)).toBe('A\n\n[[x.pdf]]\n\n```\ncode\n```\n');
    placeCaret(t.editor, 'co');
    insertAtCaret(t.editor, '![[y.png]]');
    expect(saved(t)).toBe('A\n\n[[x.pdf]]\n\n```\ncode\n```\n\n![[y.png]]\n');
  });
});

/** An empty paragraph right after the first block, with the caret in it (Enter at its end). */
function newLineAfterFirstBlock(editor: Editor): void {
  const { state } = editor;
  const pos = state.doc.child(0).nodeSize;
  const tr = state.tr.insert(pos, state.schema.nodes['paragraph']!.create());
  tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  editor.view.dispatch(tr);
}
