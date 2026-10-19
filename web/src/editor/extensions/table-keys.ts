import { Extension, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';

/**
 * A GFM table cell holds exactly one line, so Enter (and Shift+Enter) in a cell moves to the cell
 * below, adding a row at the bottom, instead of trying to split the cell.
 */
export const TableKeys = Extension.create({
  name: 'tableKeys',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Enter: () => moveToCellBelow(this.editor),
      'Shift-Enter': () => moveToCellBelow(this.editor),
    };
  },
});

function cellDepth(editor: Editor): number | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'tableCell' || name === 'tableHeader') return depth;
  }
  return null;
}

function moveToCellBelow(editor: Editor): boolean {
  const depth = cellDepth(editor);
  if (depth === null) return false;
  const { $from } = editor.state.selection;
  const table = $from.node(depth - 2);
  const tableStart = $from.start(depth - 2);
  const map = TableMap.get(table);
  const cell = map.findCell($from.before(depth) - tableStart);
  if (cell.bottom >= map.height) {
    if (!editor.can().addRowAfter()) return true;
    editor.chain().addRowAfter().run();
    return moveToCellBelow(editor);
  }
  const target = tableStart + (map.map[cell.bottom * map.width + cell.left] ?? 0);
  const { doc } = editor.state;
  const inside = target + 1 + (doc.nodeAt(target + 1)?.content.size ?? 0) + 1;
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.near(doc.resolve(Math.min(inside, doc.content.size)), -1))
      .scrollIntoView(),
  );
  return true;
}
