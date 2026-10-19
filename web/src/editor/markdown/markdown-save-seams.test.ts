// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { editorSchema } from '../schema/editor-schema';
import { editWordInBlock } from './__tests__/document-edits';
import { loadMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import { normalizeForMarkdown } from './save-normalize';

function blockStart(doc: ProseMirrorNode, index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  return pos;
}

function deleteBlock(doc: ProseMirrorNode, index: number): ProseMirrorNode {
  const start = blockStart(doc, index);
  return EditorState.create({ doc }).tr.delete(start, start + doc.child(index).nodeSize).doc;
}

function insertParagraphAfter(doc: ProseMirrorNode, index: number, text: string): ProseMirrorNode {
  const paragraph = editorSchema.nodes['paragraph']!.create(null, editorSchema.text(text));
  const end = blockStart(doc, index) + doc.child(index).nodeSize;
  return EditorState.create({ doc }).tr.insert(end, paragraph).doc;
}

function children(doc: ProseMirrorNode): ProseMirrorNode[] {
  const list: ProseMirrorNode[] = [];
  doc.forEach((child) => list.push(child));
  return list;
}

/** Saves the edit and checks that the file reads back as the editor content when exact. */
function save(source: string, edit: (doc: ProseMirrorNode) => ProseMirrorNode) {
  const { doc, snapshot } = loadMarkdown(source);
  const edited = edit(doc);
  const result = saveMarkdownWithSnapshot(edited, snapshot);
  const reloaded = children(loadMarkdown(result.text).doc);
  const readsBack =
    reloaded.length === edited.childCount &&
    children(edited).every((node, i) => normalizeForMarkdown(node).eq(reloaded[i]!));
  return { ...result, readsBack };
}

describe('a deletion between two lists keeps them apart (P2)', () => {
  it('task list and bullet list: the second list switches its bullet', () => {
    const result = save(
      '- [ ] task one\n- [ ] task two\n\nNotes:\n\n- plain one\n- plain two\n',
      (doc) => deleteBlock(doc, 1),
    );
    expect(result.text).toBe('- [ ] task one\n- [ ] task two\n\n* plain one\n* plain two\n');
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('bullet list and bullet list: only top-level markers change, CRLF kept', () => {
    const result = save(
      '- a\r\n  - nested\r\n\r\nbetween\r\n\r\n- b\r\n  - nested b\r\n- c\r\n',
      (doc) => deleteBlock(doc, 1),
    );
    expect(result.text).toBe('- a\r\n  - nested\r\n\r\n* b\r\n  - nested b\r\n* c\r\n');
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('ordered list and ordered list: the second list switches its delimiter', () => {
    const result = save('1. one\n2. two\n\nbetween\n\n1. again\n2. more\n', (doc) =>
      deleteBlock(doc, 1),
    );
    expect(result.text).toBe('1. one\n2. two\n\n1) again\n2) more\n');
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('picks a bullet no neighbour uses', () => {
    const result = save('- a\n\nx\n\n- b\n\ny\n\n* c\n', (doc) =>
      deleteBlock(deleteBlock(doc, 3), 1),
    );
    expect(result.text).toBe('- a\n\n+ b\n\n* c\n');
    expect(result.exact).toBe(true);
  });

  it('re-marks the list being re-serialised rather than the unchanged one', () => {
    const result = save('- alpha\n\nbetween\n\n- bravo\n- charlie\n', (doc) =>
      editWordInBlock(deleteBlock(doc, 1), 0),
    );
    expect(result.text).toBe('* EDITED\n\n- bravo\n- charlie\n');
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('drops the gap indentation that would pull a paragraph into the list', () => {
    const result = save('- a\n\n# Heading\n\n  indented para\n', (doc) => deleteBlock(doc, 1));
    expect(result.text).toBe('- a\n\nindented para\n');
    expect(result.exact).toBe(true);
    expect(result.readsBack).toBe(true);
  });

  it('never re-marks a source-only (verbatim) list: its bytes are its content', () => {
    // A list mixing task and plain items is kept as source only.
    const after = save('- [ ] t\n- p\n\nbetween\n\n- a\n', (doc) => deleteBlock(doc, 1));
    expect(after.text).toBe('- [ ] t\n- p\n\n* a\n');
    expect(after.exact).toBe(true);
    const before = save('- a\n\nbetween\n\n- [ ] t\n- p\n', (doc) => deleteBlock(doc, 1));
    expect(before.text).toBe('- a\n\n- [ ] t\n- p\n');
    expect(before.exact).toBe(false);
  });
});

describe('retried gaps get a real blank line (P2)', () => {
  // A new paragraph would absorb the next one (a lazy continuation) without a blank line.
  for (const eol of ['\n', '\r\n']) {
    it(`separates a new paragraph from the next one (${JSON.stringify(eol)})`, () => {
      const source = ['# Title', 'next para', ''].join(eol);
      const result = save(source, (doc) => insertParagraphAfter(doc, 0, 'Inserted'));
      expect(result.text).toBe(['# Title', '', 'Inserted', '', 'next para', ''].join(eol));
      expect(result.exact).toBe(true);
      expect(result.readsBack).toBe(true);
    });
  }
});

describe('the save check covers the text after the last block (P2)', () => {
  // A whitespace-only line after indented code joins the code once a paragraph precedes it.
  for (const source of [
    '   - [ ] task\n\n\t> - a \n\t  \n',
    '   - [ ] task\n\n    code\n      \n\nlast\n',
  ]) {
    it(`never reports exact when the file reads back differently: ${JSON.stringify(source)}`, () => {
      const result = save(source, (doc) => insertParagraphAfter(doc, 0, 'Inserted para'));
      expect(result.readsBack || !result.exact).toBe(true);
      expect(result.exact).toBe(false);
      const reparsed = loadMarkdown(result.text).snapshot;
      expect(result.snapshot.blocks.map((block) => block.source)).toEqual(
        reparsed.blocks.map((block) => block.source),
      );
      expect(result.snapshot.trailing).toBe(reparsed.trailing);
    });
  }
});
