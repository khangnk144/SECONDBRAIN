import type { ChainedCommands, Editor, Range } from '@tiptap/core';
import {
  CalendarBlank,
  Code,
  FileText,
  ListBullets,
  ListChecks,
  ListNumbers,
  Minus,
  Quotes,
  Table,
  TextHOne,
  TextHThree,
  TextHTwo,
  type Icon,
} from '@phosphor-icons/react';
import { foldText } from '../../lib/fold-text';

export interface SlashCommand {
  id: string;
  /** Key under `editor.slash`. */
  labelKey: string;
  icon: Icon;
  /** Extra words it is found by (both languages, folded); never shown. */
  keywords: string;
  /** Whether the command can run at the `/query` range (e.g. no table inside a list item). */
  can: (editor: Editor, range: Range) => boolean;
  /** Replaces the `/query` text; `'templates'` switches the menu to the template list. */
  run: (editor: Editor, range: Range) => void | 'templates';
}

type Apply = (chain: ChainedCommands) => ChainedCommands;

function blockCommand(
  id: string,
  labelKey: string,
  icon: Icon,
  keywords: string,
  apply: Apply,
): SlashCommand {
  return {
    id,
    labelKey,
    icon,
    keywords,
    can: (editor, range) => apply(editor.can().chain().deleteRange(range)).run(),
    run: (editor, range) => {
      apply(editor.chain().focus().deleteRange(range)).run();
    },
  };
}

/**
 * The slash menu, generated from this registry: only features that exist are listed (images
 * join when attachments do).
 */
export const SLASH_COMMANDS: readonly SlashCommand[] = [
  blockCommand('heading1', 'heading1', TextHOne, 'h1 heading title tieu de', (c) =>
    c.setHeading({ level: 1 }),
  ),
  blockCommand('heading2', 'heading2', TextHTwo, 'h2 heading title tieu de', (c) =>
    c.setHeading({ level: 2 }),
  ),
  blockCommand('heading3', 'heading3', TextHThree, 'h3 heading title tieu de', (c) =>
    c.setHeading({ level: 3 }),
  ),
  blockCommand('taskList', 'taskList', ListChecks, 'todo task checkbox viec', (c) =>
    c.toggleTaskList(),
  ),
  blockCommand('bulletList', 'bulletList', ListBullets, 'bullet list ul cham', (c) =>
    c.toggleBulletList(),
  ),
  blockCommand('orderedList', 'orderedList', ListNumbers, 'numbered ordered list ol so', (c) =>
    c.toggleOrderedList(),
  ),
  blockCommand('quote', 'quote', Quotes, 'quote blockquote trich dan', (c) => c.toggleBlockquote()),
  blockCommand('code', 'code', Code, 'code block ma', (c) => c.setCodeBlock()),
  blockCommand('table', 'table', Table, 'table bang', (c) =>
    c.insertTable({ rows: 3, cols: 2, withHeaderRow: true }),
  ),
  {
    id: 'date',
    labelKey: 'date',
    icon: CalendarBlank,
    keywords: 'date day deadline ngay lich han',
    can: (editor) => editor.isEditable,
    // Typing 📅 opens the date popup in place of the slash menu.
    run: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertContent('\u{1F4C5}').run();
    },
  },
  blockCommand('divider', 'divider', Minus, 'divider rule hr line duong ke', (c) =>
    c.setHorizontalRule(),
  ),
  {
    id: 'template',
    labelKey: 'template',
    icon: FileText,
    keywords: 'template mau',
    can: (editor) => editor.isEditable,
    run: () => 'templates',
  },
];

/** Commands whose label or keywords contain every word of the query (diacritics ignored). */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  label: (command: SlashCommand) => string,
): SlashCommand[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...commands];
  return commands.filter((command) => {
    const haystack = `${foldText(label(command))} ${command.keywords}`;
    return words.every((word) => haystack.includes(word));
  });
}
