import { useEffect } from 'react';
import { startNewNote } from '../new-note-flow';
import { usePanesStore } from '../panes-store';
import { useSearchUi } from '../search-ui-store';
import { useTabsStore } from '../tabs-store';
import { installShortcutListener, registerShortcut } from './shortcut-registry';

/** App-wide shortcuts of M2 (SPEC F22). `Alt+S` belongs to the editor. */
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
