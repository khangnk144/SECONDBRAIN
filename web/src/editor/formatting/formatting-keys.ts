/**
 * Word shortcuts in the editor, bound from the formatting registry so a key and its toolbar button
 * run the same command. A bound key is always taken (the browser default is prevented), even
 * where the command cannot apply: `Ctrl+U` never opens the page source, `Ctrl+B` never lets the
 * browser's own bold touch the document. Keys bound by the app registry (`Alt+S`) are left to it.
 */
import { Extension } from '@tiptap/core';
import { editorOnlyContext, FORMATTING_COMMANDS } from './formatting-commands';
import type { FormattingCommand } from './formatting-command-kit';

/** `Ctrl+Shift+S` → `Mod-Shift-s` (ProseMirror keymap notation; Ctrl also means ⌘ on a Mac). */
export function keymapName(keys: string): string {
  const parts = keys.split('+');
  const key = parts.pop() ?? '';
  const mods = parts.map((part) => (part.toLowerCase() === 'ctrl' ? 'Mod' : part));
  // A lone `+` would split into empty parts; the registry never binds it.
  return [...mods, key.length === 1 ? key.toLowerCase() : key].join('-');
}

/** Every key the editor binds, with its command. */
export function editorKeyBindings(): Array<{ keys: string; command: FormattingCommand }> {
  return FORMATTING_COMMANDS.flatMap((command) =>
    command.appShortcutId || !command.keys
      ? []
      : [command.keys, ...(command.altKeys ?? [])].map((keys) => ({ keys, command })),
  );
}

export const FormattingKeys = Extension.create({
  name: 'formattingKeys',
  // Above the schema extensions' own bindings (same keys, toggles instead of Word's styles),
  // below the popup triggers so an open popup still gets its keys first.
  priority: 1050,

  addKeyboardShortcuts() {
    const bindings: Record<string, () => boolean> = {};
    for (const { keys, command } of editorKeyBindings()) {
      bindings[keymapName(keys)] = () => {
        const context = editorOnlyContext(this.editor);
        if (command.isEnabled(context)) command.run(context);
        return true;
      };
    }
    return bindings;
  },
});
