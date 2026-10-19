import { Extension, type Editor } from '@tiptap/core';

const ITEMS = new Set(['listItem', 'taskItem']);
const CELLS = new Set(['tableCell', 'tableHeader']);

/** Name of the innermost list item holding the caret, unless a table cell is closer. */
function innermostItem(editor: Editor): string | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (CELLS.has(name)) return null;
    if (ITEMS.has(name)) return name;
  }
  return null;
}

/**
 * Inside a list item (task items too) Tab indents and Shift+Tab outdents, so nested lists can
 * be made from the keyboard; Tab is kept even when the item cannot go deeper (first item), so
 * the focus does not jump out mid-list. Outside lists and tables Tab still moves the focus on.
 */
export const ListIndentKeys = Extension.create({
  name: 'listIndentKeys',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        const item = innermostItem(this.editor);
        if (item === null) return false;
        this.editor.commands.sinkListItem(item);
        return true;
      },
      'Shift-Tab': () => {
        const item = innermostItem(this.editor);
        if (item === null) return false;
        this.editor.commands.liftListItem(item);
        return true;
      },
    };
  },
});
