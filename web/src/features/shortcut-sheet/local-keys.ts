/**
 * Keys that belong to one component rather than to the app registry. Where the component exports
 * its key list (palette, quick capture) the keys are read from there; the sidebar tree keeps its
 * keys inside its keyboard handler (`features/sidebar/tree-keyboard.ts`), so they are declared
 * here and must follow that file.
 */
import { CAPTURE_KEYS } from '../capture/capture-box';
import { PALETTE_KEYS } from '../search/palette-key-hints';

export interface LocalKeyRow {
  id: string;
  keys: readonly string[];
  /** Full i18n key of what the key does there. */
  labelKey: string;
}

function keysOf(list: ReadonlyArray<{ keys: string }>, keys: string): string {
  const found = list.find((entry) => entry.keys === keys);
  if (!found) throw new Error(`no ${keys} in the component's key list`);
  return found.keys;
}

export const LOCAL_KEYS: readonly LocalKeyRow[] = [
  { id: 'tree-rename', keys: ['F2'], labelKey: 'shortcut-sheet.local.treeRename' },
  { id: 'tree-trash', keys: ['Delete'], labelKey: 'shortcut-sheet.local.treeTrash' },
  {
    id: 'open-new-tab',
    keys: [keysOf(PALETTE_KEYS, 'Ctrl+Enter')],
    labelKey: 'shortcut-sheet.local.openNewTab',
  },
  {
    id: 'capture-new-line',
    keys: [keysOf(CAPTURE_KEYS, 'Shift+Enter')],
    labelKey: 'shortcut-sheet.local.captureNewLine',
  },
  {
    id: 'close-overlay',
    keys: [keysOf(PALETTE_KEYS, 'Esc')],
    labelKey: 'shortcut-sheet.local.closeOverlay',
  },
];
