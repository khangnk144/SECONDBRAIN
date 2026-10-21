import type { Editor, NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { NodeView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';
import { localDateString } from '../local-dates';
import { toggleTask } from './task-toggle';

/**
 * Task item with a real, round `<input type="checkbox">` (design.md §5) in front of its content.
 * Ticking writes ` ✅ <today>` and unticking removes the ✅ token (see `toggleTask`), in one
 * undoable transaction.
 */
export function createTaskItemView({ node, getPos, editor }: NodeViewRendererProps): NodeView {
  let current = node;
  const dom = document.createElement('li');
  dom.dataset['type'] = 'taskItem';
  const label = document.createElement('label');
  label.className = 'task-item__check';
  label.setAttribute('contenteditable', 'false');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'task-item__checkbox';
  const content = document.createElement('div');
  content.className = 'task-item__content';
  // The real checkbox covers the label (hit area ≥ 24 px); the round box next to it is its look.
  const box = document.createElement('span');
  box.className = 'task-item__box';
  box.setAttribute('aria-hidden', 'true');
  label.append(checkbox, box);
  dom.append(label, content);

  const sync = () => {
    const checked = current.attrs['checked'] === true;
    dom.dataset['checked'] = String(checked);
    checkbox.checked = checked;
    checkbox.disabled = !editor.isEditable;
    checkbox.setAttribute('aria-label', checkboxLabel(current));
  };
  sync();

  // Keep the editor's selection where it is when the checkbox is clicked.
  checkbox.addEventListener('mousedown', (event) => event.preventDefault());
  checkbox.addEventListener('change', () => {
    const pos = typeof getPos === 'function' ? getPos() : undefined;
    if (!editor.isEditable || typeof pos !== 'number') {
      sync();
      return;
    }
    toggleTaskAt(editor, pos, checkbox.checked);
  });
  editor.on('update', sync);

  return {
    dom,
    contentDOM: content,
    update: (updated) => {
      if (updated.type !== current.type) return false;
      current = updated;
      sync();
      return true;
    },
    // Clicks and keys on the checkbox belong to the checkbox, not to ProseMirror.
    stopEvent: (event) => event.target === checkbox,
    ignoreMutation: (mutation) =>
      mutation.type !== 'selection' && label.contains(mutation.target as globalThis.Node),
    destroy: () => {
      editor.off('update', sync);
    },
  };
}

/** Ticks or unticks the task item at `pos` (today = the local calendar date). */
export function toggleTaskAt(editor: Editor, pos: number, checked: boolean): void {
  const tr = toggleTask(editor.state.tr, pos, checked, localDateString());
  if (tr.docChanged) editor.view.dispatch(tr);
}

/** Mod+Enter: ticks or unticks the task item holding the caret. */
export function toggleTaskAtSelection(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.type.name !== 'taskItem') continue;
    if (!editor.isEditable) return true;
    toggleTaskAt(editor, $from.before(depth), node.attrs['checked'] !== true);
    return true;
  }
  return false;
}

function checkboxLabel(item: ProseMirrorNode): string {
  const text = item.firstChild?.textContent.trim() || i18n.t('editor.task.emptyTask');
  return i18n.t('editor.task.checkboxLabel', { text });
}
