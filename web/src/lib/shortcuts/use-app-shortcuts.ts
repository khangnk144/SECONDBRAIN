import { useEffect } from 'react';
import { GRAPH_ROUTE, navigateTo, SETTINGS_ROUTE } from '../app-navigation';
import { useCaptureUi } from '../capture-ui-store';
import { openDailyNote } from '../daily-flow';
import { startNewNote } from '../new-note-flow';
import { usePanesStore } from '../panes-store';
import { useSearchUi } from '../search-ui-store';
import { useShortcutSheetUi } from '../shortcut-sheet-store';
import { useTabsStore } from '../tabs-store';
import { installShortcutListener, registerShortcut } from './shortcut-registry';

/**
 * App-wide shortcuts (SPEC F22). `Alt+S` and the formatting keys belong to the editor; `Esc` to
 * each overlay. While an overlay is open the registry is suspended, so none of these fire there.
 */
export const APP_SHORTCUTS = [
  {
    id: 'toggle-left-pane',
    keys: 'Alt+1',
    labelKey: 'shortcuts.toggleLeftPane',
    run: () => usePanesStore.getState().toggleLeft(),
  },
  {
    id: 'toggle-right-pane',
    keys: 'Alt+2',
    labelKey: 'shortcuts.toggleRightPane',
    run: () => usePanesStore.getState().toggleRight(),
  },
  {
    id: 'new-note',
    keys: 'Alt+N',
    labelKey: 'shortcuts.newNote',
    run: () => void startNewNote(),
  },
  {
    id: 'daily-note',
    keys: 'Alt+T',
    labelKey: 'shortcuts.dailyNote',
    run: () => void openDailyNote(),
  },
  {
    id: 'quick-capture',
    keys: 'Alt+Q',
    labelKey: 'shortcuts.quickCapture',
    // From anywhere, including a form field (F12.1); never while an overlay is open.
    allowInInputs: true,
    run: () => useCaptureUi.getState().open(),
  },
  {
    id: 'graph',
    keys: 'Alt+G',
    labelKey: 'shortcuts.graph',
    run: () => navigateTo(GRAPH_ROUTE),
  },
  {
    id: 'settings',
    keys: 'Alt+,',
    labelKey: 'shortcuts.settings',
    run: () => navigateTo(SETTINGS_ROUTE),
  },
  {
    id: 'close-tab',
    keys: 'Alt+W',
    labelKey: 'shortcuts.closeTab',
    run: () => useTabsStore.getState().closeActiveTab(),
  },
  {
    id: 'previous-tab',
    keys: 'Alt+[',
    labelKey: 'shortcuts.previousTab',
    run: () => useTabsStore.getState().activatePrevious(),
  },
  {
    id: 'next-tab',
    keys: 'Alt+]',
    labelKey: 'shortcuts.nextTab',
    run: () => useTabsStore.getState().activateNext(),
  },
  {
    id: 'search',
    keys: 'Ctrl+K',
    labelKey: 'shortcuts.search',
    allowInInputs: true,
    run: () => useSearchUi.getState().openSearch(),
  },
  {
    id: 'shortcut-sheet',
    keys: 'Ctrl+/',
    labelKey: 'shortcuts.shortcutSheet',
    allowInInputs: true,
    run: () => useShortcutSheetUi.getState().open(),
  },
] as const;

export type AppShortcutId = (typeof APP_SHORTCUTS)[number]['id'];

/** Key combination of an app shortcut, for hints next to buttons and menu items. */
export function shortcutKeys(id: AppShortcutId): string {
  return APP_SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? '';
}

/** Installs the keydown listener and the app shortcuts while the layout is mounted. */
export function useAppShortcuts(): void {
  useEffect(() => {
    const uninstall = installShortcutListener();
    const unregister = APP_SHORTCUTS.map((shortcut) => registerShortcut({ ...shortcut }));
    return () => {
      unregister.forEach((fn) => fn());
      uninstall();
    };
  }, []);
}
