import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';

/**
 * A click in the empty space under the last block opens a new line there when that block cannot
 * take the caret's text (table, code, rule, verbatim block). No empty paragraph is kept at the end
 * of the document otherwise, so opening a note never counts as a change.
 */
export const ClickBelowEnd = Extension.create({
  name: 'clickBelowEnd',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('clickBelowEnd'),
        props: {
          handleClick: (view, _pos, event) => {
            if (!view.editable || event.target !== view.dom) return false;
            const { doc, schema } = view.state;
            const last = doc.lastChild;
            const paragraph = schema.nodes['paragraph'];
            if (!last || !paragraph || (last.isTextblock && !last.type.spec.code)) return false;
            const lastDom = view.nodeDOM(doc.content.size - last.nodeSize);
            const bottom =
              lastDom instanceof HTMLElement ? lastDom.getBoundingClientRect().bottom : 0;
            if (event.clientY <= bottom) return false;
            const tr = view.state.tr.insert(doc.content.size, paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
