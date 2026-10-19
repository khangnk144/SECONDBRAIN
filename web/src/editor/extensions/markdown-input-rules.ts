import { Extension, InputRule } from '@tiptap/core';
import { canJoin } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';
import { parseWikilinkInner } from '../markdown/wikilink-syntax';

/**
 * Input rules the schema extensions do not bring (headings, marks, lists, quotes, code blocks
 * and rules come with them):
 * - `[ ] ` / `[x] ` right after `- ` turns a fresh one-item bullet list into a task list. Mixed
 *   task/plain lists have no editable form (they load as verbatim blocks), so inside a longer
 *   bullet list the text stays as typed.
 * - `[[target#heading|alias]]` / `![[…]]` typed in full becomes a wikilink node.
 */
export const MarkdownInputRules = Extension.create({
  name: 'markdownInputRules',
  priority: 1000,

  addInputRules() {
    return [bulletToTaskListRule(), typedWikilinkRule()];
  },
});

function bulletToTaskListRule(): InputRule {
  return new InputRule({
    find: /^\s*\[([ xX]?)\]\s$/,
    handler: ({ state, range, match }) => {
      const { tr } = state;
      const $from = tr.doc.resolve(range.from);
      const depth = $from.depth;
      if (depth < 3 || $from.index(depth - 1) !== 0) return null;
      const item = $from.node(depth - 1);
      const list = $from.node(depth - 2);
      if (item.type.name !== 'listItem' || list.type.name !== 'bulletList') return null;
      if (list.childCount !== 1) return null;
      const { taskList, taskItem } = tr.doc.type.schema.nodes;
      if (!taskList || !taskItem) return null;

      const listPos = $from.before(depth - 2);
      tr.delete(range.from, range.to);
      const content = tr.doc.nodeAt(listPos)?.child(0).content;
      if (!content) return null;
      const checked = (match[1] ?? '').toLowerCase() === 'x';
      const replacement = taskList.create(
        { loose: list.attrs['loose'] },
        taskItem.create({ checked }, content),
      );
      tr.replaceWith(listPos, listPos + (tr.doc.nodeAt(listPos)?.nodeSize ?? 0), replacement);
      let caret = listPos + 3; // inside taskList > taskItem > paragraph
      // Two task lists in a row would be written as two lists: join them like Markdown reads them.
      const before = tr.doc.resolve(listPos).nodeBefore;
      if (before?.type === taskList && canJoin(tr.doc, listPos)) {
        tr.join(listPos);
        caret -= 2;
      }
      tr.setSelection(TextSelection.create(tr.doc, caret));
    },
  });
}

function typedWikilinkRule(): InputRule {
  return new InputRule({
    find: /(!?)\[\[([^[\]\n]+)\]\]$/,
    handler: ({ state, range, match }) => {
      const input = match.input ?? '';
      const index = match.index ?? 0;
      const previous = input.charAt(index - 1);
      // `\[[x]]` is literal text, and in `[[[x]]]` only the innermost pair links.
      if (previous === '\\' || previous === '[') return null;
      const parts = parseWikilinkInner(match[2] ?? '');
      const type = state.schema.nodes['wikilink'];
      if (!parts || !type) return null;
      state.tr.replaceWith(
        range.from,
        range.to,
        type.create({ ...parts, embed: match[1] === '!' }),
      );
    },
  });
}
