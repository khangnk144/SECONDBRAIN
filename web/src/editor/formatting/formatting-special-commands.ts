/**
 * Formatting commands that are more than one Tiptap chain: undo/redo (also in the source field),
 * the two link commands, clearing character formatting, and the source-mode switch.
 */
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BracketsSquare,
  Eraser,
  Link,
  MarkdownLogo,
} from '@phosphor-icons/react';
import {
  editableEditor,
  editorCommand,
  placementAllows,
  type FormattingCommand,
} from './formatting-command-kit';
import { CLEARABLE_MARKS, hasClearableMarks, inInlineCode } from './formatting-selection';

export const label = (id: string) => `editor.toolbar.${id}`;

export function historyCommand(action: 'undo' | 'redo'): FormattingCommand {
  return {
    id: action,
    labelKey: label(action),
    ...(action === 'undo' ? { keys: 'Ctrl+Z' } : { keys: 'Ctrl+Y', altKeys: ['Ctrl+Shift+Z'] }),
    group: 'history',
    icon: action === 'undo' ? ArrowCounterClockwise : ArrowClockwise,
    // The source field keeps its own history; whether it has a step is not observable.
    isEnabled: (context) => {
      if (context.sourceMode) return true;
      const editor = editableEditor(context);
      return editor !== null && editor.can()[action]();
    },
    run: (context) => {
      if (context.sourceMode) return context.sourceHistory(action);
      editableEditor(context)?.chain().focus()[action]().run();
    },
  };
}

export function headingCommand(
  level: 1 | 2 | 3,
  icon: FormattingCommand['icon'],
): FormattingCommand {
  return editorCommand({
    id: `heading${level}`,
    labelKey: label(`heading${level}`),
    keys: `Ctrl+Alt+${level}`,
    group: 'style',
    icon,
    placement: 'block',
    // Word applies the style (pressing again keeps it); "Đoạn văn" goes back.
    apply: (chain) => chain.setHeading({ level }),
    active: (editor) => editor.isActive('heading', { level }),
  });
}

export const noteLink: FormattingCommand = {
  id: 'noteLink',
  labelKey: label('noteLink'),
  group: 'links',
  icon: BracketsSquare,
  isEnabled: (context) => {
    const editor = editableEditor(context);
    return editor !== null && placementAllows(editor, 'inline') && !inInlineCode(editor.state);
  },
  // Typing `[[` opens the note suggestions; a selection is kept, the link goes after it.
  run: (context) => {
    const editor = editableEditor(context);
    if (!editor || !noteLink.isEnabled(context)) return;
    const end = editor.state.selection.to;
    editor.chain().focus().setTextSelection(end).insertContent('[[').run();
  },
};

export const clearFormatting: FormattingCommand = {
  id: 'clearFormatting',
  labelKey: label('clearFormatting'),
  keys: 'Ctrl+\\',
  group: 'clear',
  icon: Eraser,
  isEnabled: (context) => {
    const editor = editableEditor(context);
    return editor !== null && placementAllows(editor, 'inline') && hasClearableMarks(editor.state);
  },
  run: (context) => {
    const editor = editableEditor(context);
    if (!editor || !clearFormatting.isEnabled(context)) return;
    let chain = editor.chain().focus();
    for (const mark of CLEARABLE_MARKS) chain = chain.unsetMark(mark);
    chain.run();
  },
};

export const webLink: FormattingCommand = {
  id: 'webLink',
  labelKey: label('webLink'),
  group: 'links',
  icon: Link,
  isActive: (context) => Boolean(context.editor?.isActive('link')),
  isEnabled: (context) => {
    const editor = editableEditor(context);
    return editor !== null && placementAllows(editor, 'inline');
  },
  run: (context) => {
    if (webLink.isEnabled(context)) context.editWebLink();
  },
};

export const sourceMode: FormattingCommand = {
  id: 'sourceMode',
  labelKey: label('sourceMode'),
  keys: 'Alt+S',
  appShortcutId: 'source-mode',
  group: 'view',
  icon: MarkdownLogo,
  isActive: (context) => context.sourceMode,
  isEnabled: (context) => context.canToggleSource,
  run: (context) => {
    if (context.canToggleSource) context.toggleSourceMode();
  },
};
