/**
 * The formatting registry ("like Word", owner request): one list read by the toolbar, by the
 * editor's keymap (`formatting-keys.ts`) and by the shortcut sheet (`id`, `labelKey`, `keys`,
 * `group`). Word shortcuts where the browser lets a page have them; `Ctrl+K` stays the app's
 * search, so links have no shortcut.
 */
import {
  Code,
  CodeBlock,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Quotes,
  Table,
  TextB,
  TextHOne,
  TextHThree,
  TextHTwo,
  TextItalic,
  TextStrikethrough,
  TextT,
  TextUnderline,
  type Icon,
} from '@phosphor-icons/react';
import {
  editorCommand,
  type FormattingCommand,
  type FormattingContext,
} from './formatting-command-kit';
import {
  clearFormatting,
  headingCommand,
  historyCommand,
  label,
  noteLink,
  sourceMode,
  webLink,
} from './formatting-special-commands';

type Apply = Parameters<typeof editorCommand>[0]['apply'];

export type {
  FormattingCommand,
  FormattingContext,
  FormattingGroup,
} from './formatting-command-kit';

const mark = (
  id: 'bold' | 'italic' | 'underline' | 'strike' | 'code',
  keys: string,
  icon: Icon,
  apply: Apply,
) =>
  editorCommand({
    id,
    labelKey: label(id),
    keys,
    group: 'marks',
    icon,
    placement: 'inline',
    apply,
    active: (editor) => editor.isActive(id),
  });

const list = (
  id: 'bulletList' | 'orderedList' | 'taskList',
  keys: string,
  icon: Icon,
  apply: Apply,
) =>
  editorCommand({
    id,
    labelKey: label(id),
    keys,
    group: 'lists',
    icon,
    placement: 'block',
    apply,
    active: (editor) => editor.isActive(id),
  });

export const FORMATTING_COMMANDS: readonly FormattingCommand[] = [
  historyCommand('undo'),
  historyCommand('redo'),
  editorCommand({
    id: 'paragraph',
    labelKey: label('paragraph'),
    keys: 'Ctrl+Alt+0',
    group: 'style',
    icon: TextT,
    placement: 'block-or-code',
    apply: (chain) => chain.setParagraph(),
    active: (editor) => editor.isActive('paragraph'),
  }),
  headingCommand(1, TextHOne),
  headingCommand(2, TextHTwo),
  headingCommand(3, TextHThree),
  mark('bold', 'Ctrl+B', TextB, (chain) => chain.toggleBold()),
  mark('italic', 'Ctrl+I', TextItalic, (chain) => chain.toggleItalic()),
  mark('underline', 'Ctrl+U', TextUnderline, (chain) => chain.toggleUnderline()),
  mark('strike', 'Ctrl+Shift+S', TextStrikethrough, (chain) => chain.toggleStrike()),
  mark('code', 'Ctrl+E', Code, (chain) => chain.toggleCode()),
  list('bulletList', 'Ctrl+Shift+8', ListBullets, (chain) => chain.toggleBulletList()),
  list('orderedList', 'Ctrl+Shift+7', ListNumbers, (chain) => chain.toggleOrderedList()),
  list('taskList', 'Ctrl+Shift+9', ListChecks, (chain) => chain.toggleTaskList()),
  editorCommand({
    id: 'blockquote',
    labelKey: label('blockquote'),
    keys: 'Ctrl+Shift+B',
    group: 'blocks',
    icon: Quotes,
    placement: 'block',
    apply: (chain) => chain.toggleBlockquote(),
    active: (editor) => editor.isActive('blockquote'),
  }),
  editorCommand({
    id: 'codeBlock',
    labelKey: label('codeBlock'),
    keys: 'Ctrl+Alt+C',
    group: 'blocks',
    icon: CodeBlock,
    placement: 'block-or-code',
    apply: (chain) => chain.toggleCodeBlock(),
    active: (editor) => editor.isActive('codeBlock'),
  }),
  editorCommand({
    id: 'divider',
    labelKey: label('divider'),
    group: 'blocks',
    icon: Minus,
    placement: 'insert',
    apply: (chain) => chain.setHorizontalRule(),
  }),
  editorCommand({
    id: 'table',
    labelKey: label('table'),
    group: 'blocks',
    icon: Table,
    placement: 'insert',
    apply: (chain) => chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }),
  }),
  webLink,
  noteLink,
  clearFormatting,
  sourceMode,
];

export function formattingCommand(id: string): FormattingCommand {
  const command = FORMATTING_COMMANDS.find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unknown formatting command ${id}`);
  return command;
}

/** A context for commands run without the note screen (keyboard shortcuts, tests). */
export function editorOnlyContext(editor: FormattingContext['editor']): FormattingContext {
  return {
    editor,
    sourceMode: false,
    canToggleSource: false,
    toggleSourceMode: () => undefined,
    editWebLink: () => undefined,
    sourceHistory: () => undefined,
  };
}
