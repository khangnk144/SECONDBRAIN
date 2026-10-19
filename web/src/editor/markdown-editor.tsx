import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorContent, useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { VaultPath } from '../lib/api/vault-types';
import { createEditorContext } from './editor-context';
import { createEditorExtensions } from './editor-extensions';
import { createEditorHandle, type MarkdownEditorHandle } from './editor-handle';
import { EditorOverlays } from './editor-overlays';
import { adoptMarkdownSchema, asInitialContent } from './shared-schema';
import './markdown-editor.css';
import './editor-nodes.css';
import './editor-blocks.css';
import './editor-popups.css';

export type { FocusPosition, MarkdownEditorHandle } from './editor-handle';

export interface MarkdownEditorProps {
  /** From `loadMarkdown()`; used as is (node identity keeps saves fast). */
  initialDoc: ProseMirrorNode;
  /** Context for link resolution and new-note folders. */
  notePath: VaultPath;
  /** False for non-UTF-8 notes and while a conflict is open. */
  editable: boolean;
  ariaLabel: string;
  /** Every doc-changing transaction (not selection-only ones, not `replaceDoc`). */
  onDocChange(doc: ProseMirrorNode): void;
  onReady?(handle: MarkdownEditorHandle): void;
}

/**
 * The writing surface (SPEC F3/F4/F6, design.md screen 2): WYSIWYG Markdown on the shared
 * schema, with input rules, popups and link/tag/date rendering. Remount it (React `key`) to open
 * another note; use the handle to reload the same note.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  const { initialDoc, notePath, editable, ariaLabel } = props;
  const [context] = useState(() => createEditorContext(notePath));
  const [extensions] = useState(() => createEditorExtensions(context));
  const latest = useRef(props);
  latest.current = props;

  const editor = useEditor(
    {
      extensions,
      content: asInitialContent(initialDoc),
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: false,
      injectCSS: false,
      onBeforeCreate: adoptMarkdownSchema,
      editorProps: { attributes: rootAttributes(ariaLabel, editable) },
      onTransaction: ({ editor: current, transaction, appendedTransactions }) => {
        if (transaction.docChanged || appendedTransactions.some((tr) => tr.docChanged)) {
          latest.current.onDocChange(current.state.doc);
        }
      },
    },
    [],
  );

  const handle = useMemo(() => createEditorHandle(editor), [editor]);

  useEffect(() => {
    latest.current.onReady?.(handle);
  }, [handle]);

  useEffect(() => {
    context.setNotePath(notePath);
  }, [context, notePath]);

  useEffect(() => {
    if (editor.isEditable === editable && editor.options.editable === editable) return;
    editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    editor.setOptions({ editorProps: { attributes: rootAttributes(ariaLabel, editable) } });
  }, [editor, ariaLabel, editable]);

  return (
    <div className="markdown-editor">
      <EditorContent editor={editor} />
      <EditorOverlays editor={editor} context={context} />
    </div>
  );
}

function rootAttributes(ariaLabel: string, editable: boolean): Record<string, string> {
  return {
    class: 'markdown-editor__content',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-label': ariaLabel,
    'aria-readonly': editable ? 'false' : 'true',
  };
}
