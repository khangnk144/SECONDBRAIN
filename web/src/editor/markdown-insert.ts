/**
 * Writing Markdown into the note through the editor (AI actions): the text is parsed by the
 * converter into the editor's own nodes, then inserted or put in place of a range by one
 * transaction. The note session saves it like typing; blocks nobody touched keep their bytes
 * (SPEC §4.9); one undo takes the whole insertion back (its own history step).
 */
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, Slice, type Node as ProseMirrorNode, type Schema } from '@tiptap/pm/model';
import { Selection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { loadMarkdown } from './markdown/markdown-document';

/** Markdown → top-level editor nodes; null when nothing is left (blank text). */
export function markdownToBlocks(markdown: string, schema: Schema): Fragment | null {
  let source = markdown.replace(/\r\n?/g, '\n').replace(/^\n+|\s+$/g, '');
  if (source === '') return null;
  // A first line `---` would be read as front matter; a blank line in front keeps it text.
  if (source.startsWith('---')) source = `\n${source}`;
  const { doc } = loadMarkdown(source, schema);
  return doc.childCount > 0 && doc.textContent.trim() !== '' ? doc.content : null;
}

/** Position right after the top-level block that holds `pos` (between blocks: `pos` itself). */
export function afterTopLevelBlock(doc: ProseMirrorNode, pos: number): number {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return $pos.depth === 0 ? $pos.pos : $pos.after(1);
}

/** Inserts blocks at a position between top-level blocks; the caret goes to their end. */
export function insertBlocksAt(state: EditorState, pos: number, blocks: Fragment): Transaction {
  const tr = state.tr.insert(pos, blocks);
  tr.setSelection(Selection.near(tr.doc.resolve(pos + blocks.size), -1));
  return closeHistory(tr).scrollIntoView();
}

/**
 * Replaces `from…to` with Markdown. Text that is one paragraph, put inside one paragraph, stays
 * inline (spaces around the old words are kept); anything else is fitted in like a paste. Inside a
 * code block the text goes in as plain text. Null when the Markdown is blank.
 */
export function replaceRangeWithMarkdown(
  state: EditorState,
  from: number,
  to: number,
  markdown: string,
): Transaction | null {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  const sameTextblock = $from.sameParent($to) && $from.parent.isTextblock;
  if (sameTextblock && $from.parent.type.spec.code) {
    const text = markdown.replace(/\r\n?/g, '\n');
    if (text.trim() === '') return null;
    return closeHistory(state.tr.insertText(text, from, to)).scrollIntoView();
  }
  const blocks = markdownToBlocks(markdown, state.schema);
  if (!blocks) return null;
  const first = blocks.firstChild;
  let slice: Slice;
  if (sameTextblock && blocks.childCount === 1 && first?.type.name === 'paragraph') {
    const old = state.doc.textBetween(from, to, '\n', ' ');
    slice = new Slice(withEdgeSpaces(first.content, old, state.schema), 0, 0);
  } else {
    slice = Slice.maxOpen(blocks);
  }
  const tr = state.tr.replaceRange(from, to, slice);
  return closeHistory(tr).scrollIntoView();
}

/** Keeps the blanks that surrounded the replaced words (the new text comes back trimmed). */
function withEdgeSpaces(content: Fragment, old: string, schema: Schema): Fragment {
  const leading = /^[ \t]*/.exec(old)?.[0] ?? '';
  const trailing = /[ \t]*$/.exec(old)?.[0] ?? '';
  let result = content;
  if (leading) result = Fragment.from(schema.text(leading)).append(result);
  if (trailing && trailing !== old) result = result.append(Fragment.from(schema.text(trailing)));
  return result;
}

/** A paragraph `<label> [[a]], [[b]]` of wikilink nodes (targets as they should be written). */
export function linkListParagraph(
  schema: Schema,
  label: string,
  targets: readonly string[],
): ProseMirrorNode {
  const wikilink = schema.nodes['wikilink']!;
  const parts: ProseMirrorNode[] = [schema.text(`${label} `)];
  targets.forEach((target, index) => {
    if (index > 0) parts.push(schema.text(', '));
    parts.push(wikilink.create({ target, heading: null, alias: null, embed: false }));
  });
  return schema.nodes['paragraph']!.create(null, parts);
}

/** A transaction that only ends the current undo step (typing after an insertion is its own). */
export function closeHistoryStep(state: EditorState): Transaction {
  return closeHistory(state.tr);
}
