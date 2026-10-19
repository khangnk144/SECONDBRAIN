import type { Content, Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { editorSchema } from './schema/editor-schema';

/**
 * Makes a Tiptap editor use the one `editorSchema` instance that `loadMarkdown()` builds its
 * documents and snapshots with. ProseMirror compares node types by identity, so a document from
 * another (even structurally equal) schema would make every save see every block as changed and
 * break commands that check content types. Tiptap always builds a fresh schema from its
 * extensions; this swaps it before the first document and every plugin, node view and command
 * read it (they look the schema up lazily). Behaviour extensions must therefore never change a
 * node's spec: only node views, plugins, input rules and shortcuts.
 *
 * Pass as the editor's `onBeforeCreate` option (it runs after the schema is built and before the
 * initial document is created).
 */
export function adoptMarkdownSchema({ editor }: { editor: Editor }): void {
  assertSameShape(editor.schema, editorSchema);
  (editor.extensionManager as { schema: Schema }).schema = editorSchema;
  (editor as { schema: Schema }).schema = editorSchema;
}

function assertSameShape(built: Schema, shared: Schema): void {
  const names = (schema: Schema) =>
    [...Object.keys(schema.nodes), '|', ...Object.keys(schema.marks)].sort().join(',');
  if (names(built) !== names(shared)) {
    throw new Error('Editor extensions changed the node or mark set of the Markdown schema.');
  }
}

/**
 * Tiptap accepts a ProseMirror node as initial content at runtime (it is used as is), but its
 * `content` option is typed for JSON/HTML only.
 */
export function asInitialContent(doc: ProseMirrorNode): Content {
  return doc as unknown as Content;
}
