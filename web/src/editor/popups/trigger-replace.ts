import type { Editor } from '@tiptap/core';
import type { Fragment, Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  activeTrigger,
  closeTrigger,
  triggersKey,
  type TriggerMatch,
} from '../extensions/editor-triggers';

/**
 * Replaces the typed trigger (`[[que`, `#ta`, `@`, …) with `content` – plain text without marks,
 * or nodes – and closes the popup. Does nothing when the popup was closed or moved meanwhile.
 */
export function replaceTrigger(
  editor: Editor,
  trigger: TriggerMatch,
  content: string | ProseMirrorNode | Fragment,
): boolean {
  const current = activeTrigger(editor.state);
  if (!current || current.kind !== trigger.kind || current.from !== trigger.from) return false;
  const { schema, doc } = editor.state;
  // Inserted text never sticks to the word after it ("📅 2026-10-20 Ôn tập", not "…20Ôn").
  const next = doc.textBetween(
    current.to,
    Math.min(current.to + 1, doc.content.size),
    '\n',
    '\uFFFC',
  );
  const text = typeof content === 'string' && /^\S/u.test(next) ? `${content} ` : content;
  const replacement = typeof text === 'string' ? schema.text(text) : text;
  const tr = editor.state.tr.replaceWith(current.from, current.to, replacement);
  tr.setMeta(triggersKey, { close: true });
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Closes the popup without changing the text. */
export function dismissTrigger(editor: Editor): void {
  if (activeTrigger(editor.state)) closeTrigger(editor.view);
}
