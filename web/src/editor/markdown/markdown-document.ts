/**
 * Public API of the block-preserving Markdown ⇄ ProseMirror converter (SPEC §4.9, F3).
 *
 * - `loadMarkdown(s)` parses a whole file: front matter and BOM are kept aside, the body becomes
 *   editor blocks (supported constructs as editable nodes, everything else as verbatim blocks).
 * - `saveMarkdown(doc, snapshot)` writes the file back: unchanged blocks byte for byte, changed
 *   blocks in canonical Markdown, so `saveMarkdown(loadMarkdown(s).doc, loadMarkdown(s).snapshot)`
 *   is `s` for every string.
 * - `saveMarkdownWithSnapshot` also returns the snapshot of the written text, so the next save
 *   stays local without parsing the whole note again.
 */
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { editorSchema } from '../schema/editor-schema';
import { parseBody } from './body-blocks';
import { splitFrontmatter } from './frontmatter-split';
import { detectEol, type Eol } from './line-endings';
import type { MarkdownSnapshot } from './markdown-snapshot';
import { saveDocument, type SaveResult } from './markdown-save';

export type { MarkdownSnapshot } from './markdown-snapshot';
export type { SaveResult } from './markdown-save';

export interface LoadedMarkdown {
  /** The body only; the front matter is not part of the editor document. */
  doc: ProseMirrorNode;
  /** Opaque: everything needed to save without touching unchanged bytes. */
  snapshot: MarkdownSnapshot;
  /** The exact front matter text, from the opening fence through the closing fence's line end. */
  frontmatter: { raw: string } | null;
}

export function loadMarkdown(source: string, schema: Schema = editorSchema): LoadedMarkdown {
  const bom = source.charCodeAt(0) === 0xfeff;
  const split = splitFrontmatter(source);
  const body = source.slice(split.bodyStart);
  const parsed = parseBody(body, schema);
  const nodes = parsed.blocks.map((block) => block.node);
  const doc = schema.topNodeType.create(
    null,
    nodes.length > 0 ? nodes : [schema.nodes['paragraph']!.create()],
  );
  const snapshot: MarkdownSnapshot = {
    schema,
    bom,
    frontmatter: split.raw ?? '',
    eol: detectEol(source),
    blocks: parsed.blocks,
    trailing: parsed.trailing,
    definitionsPrefix: parsed.definitionsPrefix,
  };
  return { doc, snapshot, frontmatter: split.raw === null ? null : { raw: split.raw } };
}

export function saveMarkdown(doc: ProseMirrorNode, snapshot: MarkdownSnapshot): string {
  return saveDocument(doc, snapshot).text;
}

export function saveMarkdownWithSnapshot(
  doc: ProseMirrorNode,
  snapshot: MarkdownSnapshot,
): SaveResult {
  return saveDocument(doc, snapshot);
}

/** The line ending used for re-serialised text: the file's first line ending (LF when none). */
export function documentEol(snapshot: MarkdownSnapshot): Eol {
  return snapshot.eol;
}
