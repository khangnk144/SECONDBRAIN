import { EditorState } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { loadMarkdown, saveMarkdownWithSnapshot } from './markdown-document';
import { editorSchema as schema } from '../schema/editor-schema';

const text = (value: string, marks: string[] = []) =>
  schema.text(
    value,
    marks.map((name) => schema.marks[name]!.create()),
  );
const paragraph = (...children: ProseMirrorNode[]) =>
  schema.nodes.paragraph!.create(null, children);

/** Replaces the first block of "a\n\nb\n" with `block` and saves. */
function saveFirstBlock(block: ProseMirrorNode) {
  const { doc, snapshot } = loadMarkdown('a\n\nb\n');
  const state = EditorState.create({ doc });
  const next = state.tr.replaceWith(0, doc.child(0).nodeSize, block).doc;
  return saveMarkdownWithSnapshot(next, snapshot);
}

describe('whitespace Markdown cannot hold is dropped or moved, never encoded', () => {
  it.each([
    ['a trailing space', paragraph(text('a b ')), 'a b\n\nb\n'],
    ['a leading space', paragraph(text(' a b')), 'a b\n\nb\n'],
    ['a trailing tab', paragraph(text('x\t')), 'x\n\nb\n'],
    [
      'a heading with a trailing space',
      schema.nodes.heading!.create({ level: 2 }, [text('H ')]),
      '## H\n\nb\n',
    ],
    [
      'spaces at the start of the line after a hard break',
      paragraph(text('a'), schema.nodes.hardBreak!.create(), text(' c ')),
      'a\\\nc\n\nb\n',
    ],
    [
      'a space before a hard break (Markdown keeps it)',
      paragraph(text('a '), schema.nodes.hardBreak!.create(), text('c')),
      'a \\\nc\n\nb\n',
    ],
    [
      'a space inside the end of a bold run',
      paragraph(text('a '), text('bold ', ['bold']), text('c')),
      'a **bold** c\n\nb\n',
    ],
    [
      'a space inside the start of an italic run',
      paragraph(text('a'), text(' it', ['italic']), text(' c')),
      'a *it* c\n\nb\n',
    ],
    [
      'a bold run of spaces only',
      paragraph(text('a'), text('  ', ['bold']), text('c')),
      'a  c\n\nb\n',
    ],
    [
      'a trailing hard break after a space',
      paragraph(text('a '), schema.nodes.hardBreak!.create()),
      'a\n\nb\n',
    ],
  ])('%s', (_name, block, expected) => {
    const result = saveFirstBlock(block);
    expect(result.text).toBe(expected);
    expect(result.text).not.toContain('&#x');
    expect(result.exact).toBe(true);
  });

  it('keeps spaces inside inline code and between words untouched', () => {
    const result = saveFirstBlock(paragraph(text('a  b '), text(' code ', ['code'])));
    // CommonMark strips one space on each side of a code span, so the writer pads it.
    expect(result.text).toBe('a  b `  code  `\n\nb\n');
    expect(result.exact).toBe(true);
  });
});
