import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  EditorState,
  NodeSelection,
  Selection,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import type { CaretTarget } from './markdown/source-offset-caret';

/** Imperative API of `<MarkdownEditor>` for the note session. */
export interface MarkdownEditorHandle {
  /** The Tiptap editor itself, for UI built around it (the formatting toolbar). */
  readonly editor?: Editor;
  /**
   * `{ block }` = index of a top-level node: caret at its start, scrolled into view.
   * `{ caret }` = a place from `caretForSourceOffset` (a template's `{{cursor}}`).
   */
  focus(position?: FocusPosition): void;
  /** Loads another document (outside edits, source mode); starts a fresh undo history. */
  replaceDoc(doc: ProseMirrorNode, opts?: { keepSelection?: boolean }): void;
  getDoc(): ProseMirrorNode;
  /**
   * Applies an edit as a normal editor transaction (undo takes it back, the session hears it
   * like typing). `build` returns null to change nothing. Returns whether something was applied.
   */
  edit(build: (state: EditorState) => Transaction | null): boolean;
}

export type FocusPosition = 'start' | 'end' | { block: number } | { caret: CaretTarget };

export function createEditorHandle(editor: Editor): MarkdownEditorHandle {
  return {
    editor,
    focus: (position) => focusEditor(editor, position),
    replaceDoc: (doc, opts) => replaceEditorDoc(editor, doc, opts?.keepSelection === true),
    getDoc: () => editor.state.doc,
    edit: (build) => {
      if (editor.isDestroyed) return false;
      const tr = build(editor.state);
      if (!tr) return false;
      editor.view.dispatch(tr);
      return true;
    },
  };
}

function focusEditor(editor: Editor, position: FocusPosition | undefined): void {
  if (editor.isDestroyed) return;
  if (position === undefined || position === 'start' || position === 'end') {
    editor.commands.focus(position ?? null);
    return;
  }
  if ('caret' in position && position.caret.kind !== 'block') {
    placeCaret(editor, position.caret);
    return;
  }
  const block = 'caret' in position ? (position.caret as { index: number }).index : position.block;
  const { doc } = editor.state;
  const index = Math.max(0, Math.min(block, doc.childCount - 1));
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += doc.child(i).nodeSize;
  const node = doc.child(index);
  // An atom block (verbatim, rule) is selected as a whole; anything else gets the caret inside.
  const selection =
    node.isAtom && NodeSelection.isSelectable(node)
      ? NodeSelection.create(doc, pos)
      : Selection.near(doc.resolve(Math.min(pos + 1, doc.content.size)));
  editor.view.dispatch(editor.state.tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
}

/**
 * A text caret, or an empty paragraph with the caret in it. The paragraph is left out of the undo
 * history (undo would only remove an empty line) and writes nothing until text is typed into it.
 */
function placeCaret(editor: Editor, target: Exclude<CaretTarget, { kind: 'block' }>): void {
  const { state } = editor;
  const pos = Math.max(0, Math.min(target.pos, state.doc.content.size));
  const tr = state.tr;
  if (target.kind === 'new-paragraph') {
    const paragraph = state.schema.nodes['paragraph']!.create();
    tr.insert(pos, paragraph).setMeta('addToHistory', false);
    tr.setSelection(TextSelection.create(tr.doc, pos + 1));
  } else {
    tr.setSelection(Selection.near(tr.doc.resolve(pos)));
  }
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

function replaceEditorDoc(editor: Editor, doc: ProseMirrorNode, keepSelection: boolean): void {
  if (editor.isDestroyed) return;
  const previous = editor.state.selection;
  const selection = keepSelection ? clampedSelection(doc, previous) : Selection.atStart(doc);
  // A new state (same plugins) instead of a transaction: undo must not step back across a reload,
  // and the given nodes are used as they are, so later saves can match them by identity.
  const state = EditorState.create({ doc, selection, plugins: editor.state.plugins });
  editor.view.updateState(state);
  // Listeners (open popups) re-read the state; an empty transaction reports no document change.
  editor.emit('transaction', { editor, transaction: state.tr, appendedTransactions: [] });
}

function clampedSelection(doc: ProseMirrorNode, previous: Selection): Selection {
  const size = doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  try {
    return TextSelection.between(
      doc.resolve(clamp(previous.anchor)),
      doc.resolve(clamp(previous.head)),
    );
  } catch {
    return Selection.atStart(doc);
  }
}
