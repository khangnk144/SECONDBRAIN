/**
 * Types and builders of the formatting registry. A command runs against a `FormattingContext`:
 * the rich-text editor (null while it is not mounted) plus what the note screen offers around it
 * (source mode, the web-link dialog, the source field's own undo history).
 */
import type { ChainedCommands, Editor } from '@tiptap/core';
import type { Icon } from '@phosphor-icons/react';
import { inCodeBlock, inTableCell, verbatimSelected } from './formatting-selection';

export type FormattingGroup =
  'history' | 'style' | 'marks' | 'lists' | 'blocks' | 'links' | 'clear' | 'view';

export interface FormattingContext {
  editor: Editor | null;
  /** The note shows its Markdown source instead of the rich text. */
  sourceMode: boolean;
  /** False while source mode cannot be switched (a conflict is open). */
  canToggleSource: boolean;
  toggleSourceMode: () => void;
  /** Asks for a web address and links the selection to it (or edits/removes the link). */
  editWebLink: () => void;
  /** Undo/redo inside the source field (its own native history). */
  sourceHistory: (action: 'undo' | 'redo') => void;
}

export interface FormattingCommand {
  id: string;
  /** Full i18n key of the label (`editor.toolbar.*`). */
  labelKey: string;
  /** Shortcut as shown to the owner, e.g. `Ctrl+B` (same notation as the app registry). */
  keys?: string;
  /** Further shortcuts for the same command, e.g. `Ctrl+Shift+Z` for redo. */
  altKeys?: readonly string[];
  /**
   * Id in the app shortcut registry when the key is bound there rather than by the editor's
   * keymap (source mode works in the source field too), so a sheet can list it once.
   */
  appShortcutId?: string;
  group: FormattingGroup;
  icon: Icon;
  /** Toggle commands: whether the selection already has it (`aria-pressed`). */
  isActive?: (context: FormattingContext) => boolean;
  isEnabled: (context: FormattingContext) => boolean;
  run: (context: FormattingContext) => void;
}

/** Where an editor command may run, besides what Tiptap's own `can()` says. */
export type Placement =
  /** Character formatting: not in a code block. */
  | 'inline'
  /** Turns the current block into another kind: not in a table cell or a code block. */
  | 'block'
  /** Like `block`, but also leads out of a code block (paragraph, code block itself). */
  | 'block-or-code'
  /** Inserts a new block: not in a table cell or a code block. */
  | 'insert';

/** The rich-text editor when it can take an edit now, else null. */
export function editableEditor(context: FormattingContext): Editor | null {
  const { editor } = context;
  if (!editor || editor.isDestroyed || !editor.isEditable || context.sourceMode) return null;
  return editor;
}

export function placementAllows(editor: Editor, placement: Placement): boolean {
  const { state } = editor;
  if (verbatimSelected(state)) return false;
  if (inCodeBlock(state) && placement !== 'block-or-code') return false;
  return placement === 'inline' || !inTableCell(state);
}

type Apply = (chain: ChainedCommands) => ChainedCommands;

interface EditorCommandSpec extends Omit<FormattingCommand, 'isActive' | 'isEnabled' | 'run'> {
  placement: Placement;
  apply: Apply;
  active?: (editor: Editor) => boolean;
}

/** A command that changes the rich text through one Tiptap chain, then gives focus back. */
export function editorCommand(spec: EditorCommandSpec): FormattingCommand {
  const { placement, apply, active, ...rest } = spec;
  const isEnabled = (context: FormattingContext): boolean => {
    const editor = editableEditor(context);
    return (
      editor !== null && placementAllows(editor, placement) && apply(editor.can().chain()).run()
    );
  };
  return {
    ...rest,
    ...(active
      ? {
          isActive: (context: FormattingContext) =>
            Boolean(context.editor && active(context.editor)),
        }
      : {}),
    isEnabled,
    run: (context) => {
      const editor = editableEditor(context);
      if (editor && isEnabled(context)) apply(editor.chain().focus()).run();
    },
  };
}
