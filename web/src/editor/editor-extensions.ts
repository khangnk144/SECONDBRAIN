import type { AnyExtension, Node } from '@tiptap/core';
import type { EditorContext } from './editor-context';
import { ClickBelowEnd } from './extensions/click-below-end';
import { createEditorTriggers } from './extensions/editor-triggers';
import { InlineDecorations } from './extensions/inline-decorations';
import { ListIndentKeys } from './extensions/list-indent-keys';
import { MarkdownInputRules } from './extensions/markdown-input-rules';
import { MarkdownPaste } from './extensions/markdown-paste';
import { TableKeys } from './extensions/table-keys';
import { WritingFocus } from './extensions/writing-focus';
import { createTaskItemView, toggleTaskAtSelection } from './extensions/task-item-view';
import { createVerbatimBlockView } from './extensions/verbatim-block-view';
import { createWikilinkKeys } from './extensions/wikilink-follow';
import { createWikilinkView } from './extensions/wikilink-view';
import { createSchemaExtensions } from './schema/editor-schema';

/** Undo/redo depth (SPEC F3: at least 100 steps). */
export const HISTORY_DEPTH = 200;

/**
 * The editor's extensions: the Markdown schema's node and mark types (unchanged in meaning) with
 * the writing behaviour added on top – node views, input rules, popups, decorations, paste.
 */
export function createEditorExtensions(context: EditorContext): AnyExtension[] {
  const schemaExtensions = createSchemaExtensions()
    // An appended empty paragraph would count as a document change on the first click and
    // would cancel "Backspace undoes the input rule"; gap cursors reach the end instead.
    .filter((extension) => extension.name !== 'trailingNode')
    .map((extension) => withBehaviour(extension, context));
  return [
    ...schemaExtensions,
    MarkdownInputRules,
    InlineDecorations,
    createWikilinkKeys(context),
    createEditorTriggers(context),
    TableKeys,
    ListIndentKeys,
    MarkdownPaste,
    WritingFocus,
    ClickBelowEnd,
  ];
}

function withBehaviour(extension: AnyExtension, context: EditorContext): AnyExtension {
  switch (extension.name) {
    case 'undoRedo':
      return extension.configure({ depth: HISTORY_DEPTH });
    case 'taskItem':
      return (extension as Node).extend({
        addNodeView: () => createTaskItemView,
        addKeyboardShortcuts() {
          return { ...this.parent?.(), 'Mod-Enter': () => toggleTaskAtSelection(this.editor) };
        },
      });
    case 'wikilink':
      return extension.extend({ addNodeView: () => createWikilinkView(context) });
    case 'verbatimBlock':
      return extension.extend({ addNodeView: () => createVerbatimBlockView });
    default:
      return extension;
  }
}
