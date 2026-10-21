/**
 * The shortcut sheet's content (SPEC F22.2: generated from the registry, exactly the implemented
 * shortcuts): the app shortcuts registered right now, the editor's formatting keys from the
 * formatting registry (plus its Ctrl+Enter), the keys of single screens (Today's strip, the
 * calendar grid, the brain map) and the component-local keys. A formatting entry that names an app
 * shortcut (`appShortcutId`, e.g. source mode) is the same action, so it is listed once, by the
 * app registry – only while that shortcut is registered (Alt+S exists while a note is shown).
 * Formatting entries without keys (divider, table, links) are not listed.
 */
import { FORMATTING_COMMANDS } from '../../editor/formatting/formatting-commands';
import { listShortcuts, type ShortcutInfo } from '../../lib/shortcuts/shortcut-registry';
import { LOCAL_KEYS, type LocalKeyRow } from './local-keys';
import { EDITOR_CONTEXT_KEYS, SCREEN_KEY_GROUPS, type ScreenKeyGroup } from './screen-keys';

export interface SheetRow {
  id: string;
  /** Alternatives, each like `Ctrl+Shift+Z`. */
  keys: readonly string[];
  labelKey: string;
}

export interface SheetGroup {
  id: 'app' | 'editor' | ScreenKeyGroup['id'] | 'local';
  titleKey: string;
  rows: SheetRow[];
}

interface FormattingEntry {
  id: string;
  labelKey: string;
  keys?: string;
  altKeys?: readonly string[];
  appShortcutId?: string;
}

export function shortcutSheetGroups(
  registered: readonly ShortcutInfo[] = listShortcuts(),
  formatting: readonly FormattingEntry[] = FORMATTING_COMMANDS,
  local: readonly LocalKeyRow[] = LOCAL_KEYS,
  screens: readonly ScreenKeyGroup[] = SCREEN_KEY_GROUPS,
  editorContext: readonly LocalKeyRow[] = EDITOR_CONTEXT_KEYS,
): SheetGroup[] {
  const app = registered.map((shortcut) => ({
    id: shortcut.id,
    keys: [shortcut.keys],
    labelKey: shortcut.labelKey,
  }));
  const editor = formatting.flatMap((command) =>
    command.keys && !command.appShortcutId
      ? [
          {
            id: command.id,
            keys: [command.keys, ...(command.altKeys ?? [])],
            labelKey: command.labelKey,
          },
        ]
      : [],
  );
  const groups: SheetGroup[] = [
    { id: 'app', titleKey: 'shortcut-sheet.groups.app', rows: app },
    { id: 'editor', titleKey: 'shortcut-sheet.groups.editor', rows: [...editor, ...editorContext] },
    ...screens.map((screen) => ({ ...screen, rows: [...screen.rows] })),
    { id: 'local', titleKey: 'shortcut-sheet.groups.local', rows: [...local] },
  ];
  return groups.filter((group) => group.rows.length > 0);
}
