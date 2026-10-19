import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection } from '@tiptap/pm/state';
import { getNote } from '../../lib/api/notes-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { activeTrigger, triggersKey, type TriggerMatch } from '../extensions/editor-triggers';
import { localDateString } from '../local-dates';
import { loadMarkdown } from '../markdown/markdown-document';

/** Same variables as the server's new-note templates (F14): title, date, time; cursor removed. */
export function fillTemplateVariables(template: string, notePath: VaultPath, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const title = noteTitleFromPath(notePath);
  // Replacement functions, so `$&` in a title is inserted literally.
  return template
    .replace(/\{\{title\}\}/g, () => title)
    .replace(/\{\{date\}\}/g, () => localDateString(now))
    .replace(/\{\{time\}\}/g, () => time)
    .replace(/\{\{cursor\}\}/g, '');
}

/** The template's body as editor content: variables filled, front matter dropped. */
export async function loadTemplateBody(
  templatePath: VaultPath,
  notePath: VaultPath,
): Promise<ProseMirrorNode> {
  const { content } = await getNote(templatePath);
  return loadMarkdown(fillTemplateVariables(content, notePath, new Date())).doc;
}

/**
 * Puts the template's blocks where `/` was typed: in place of that empty paragraph at the top
 * level, or after the enclosing top-level block when typed inside a list or quote (verbatim
 * blocks may only live at the top level).
 */
export function insertTemplateBody(
  editor: Editor,
  trigger: TriggerMatch,
  body: ProseMirrorNode,
): boolean {
  const current = activeTrigger(editor.state);
  if (!current || current.kind !== 'slash' || current.from !== trigger.from) return false;
  const tr = editor.state.tr.delete(current.from, current.to);
  tr.setMeta(triggersKey, { close: true });
  const $pos = tr.doc.resolve(current.from);
  let insertAt: number;
  if ($pos.depth === 1 && $pos.parent.content.size === 0) {
    insertAt = $pos.before(1);
    tr.replaceWith(insertAt, $pos.after(1), body.content);
  } else {
    insertAt = $pos.after(1);
    tr.insert(insertAt, body.content);
  }
  const end = insertAt + body.content.size;
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size)), -1));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}
