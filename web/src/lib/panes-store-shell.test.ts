import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_SHELL,
  leftPaneMode,
  resetShellSession,
  showFolderTree,
  usePanesStore,
  type ShellContext,
} from './panes-store';
import { resetAppState } from './testing/reset-app-state';
import { useVaultStore } from './vault-store';

const shell = (patch: Partial<ShellContext>): ShellContext => ({ ...DEFAULT_SHELL, ...patch });

describe('what Alt+1 / Alt+2 control in each layout (F35.2, F28.1)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    resetShellSession();
  });

  it('(F35.2) calm: the left pane; bento: the folder pane on note routes, else a drawer', () => {
    expect(leftPaneMode(shell({ style: 'calm' }))).toBe('pane');
    expect(leftPaneMode(shell({ style: 'calm', width: 'narrow' }))).toBe('pane');
    expect(leftPaneMode(shell({ style: 'bento', folderRoute: true }))).toBe('folder-pane');
    expect(leftPaneMode(shell({ style: 'bento', folderRoute: false }))).toBe('drawer');
    // Below 1200 px bento opens the tree as a drawer even on note routes (the note keeps room).
    for (const width of ['medium', 'narrow'] as const) {
      expect(leftPaneMode(shell({ style: 'bento', folderRoute: true, width }))).toBe('drawer');
    }
    // Phones: a drawer in both styles (F28.1).
    expect(leftPaneMode(shell({ style: 'calm', width: 'compact' }))).toBe('drawer');
  });

  it('(F35.2) calm toggles keep their exact behavior and storage', () => {
    usePanesStore.getState().toggleLeft();
    expect(usePanesStore.getState()).toMatchObject({ leftCollapsed: true, drawerOpen: false });
    expect(JSON.parse(localStorage.getItem('sb:vault-a:panes') ?? '{}')).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
    });
    expect(localStorage.getItem('sb:vault-a:folder-pane')).toBeNull();
  });

  it('(F35.2) bento folder pane: its own flag, stored per vault; drawers are never stored', () => {
    const store = usePanesStore.getState();
    store.setShell(shell({ style: 'bento', folderRoute: true }));
    store.toggleLeft();
    expect(usePanesStore.getState()).toMatchObject({
      folderPaneCollapsed: true,
      leftCollapsed: false,
    });
    expect(JSON.parse(localStorage.getItem('sb:vault-a:folder-pane') ?? '{}')).toEqual({
      collapsed: true,
    });
    store.setShell(shell({ style: 'bento', folderRoute: false }));
    store.toggleLeft();
    expect(usePanesStore.getState()).toMatchObject({ drawerOpen: true, folderPaneCollapsed: true });
    store.closeDrawer();
    expect(usePanesStore.getState().drawerOpen).toBe(false);
    expect(localStorage.getItem('sb:vault-a:panes')).toBeNull();
  });

  it('(F35.2) a folder-pane toggle before hydration wins and is saved then', () => {
    useVaultStore.setState({ vaultId: null });
    usePanesStore.setState({ hydrated: false, earlyToggles: {} });
    localStorage.setItem('sb:vault-a:folder-pane', JSON.stringify({ collapsed: false }));
    usePanesStore.getState().setShell(shell({ style: 'bento', folderRoute: true }));
    usePanesStore.getState().toggleLeft();
    useVaultStore.setState({ vaultId: 'vault-a' });
    usePanesStore.getState().hydrate();
    expect(usePanesStore.getState().folderPaneCollapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem('sb:vault-a:folder-pane') ?? '{}')).toEqual({
      collapsed: true,
    });
  });

  it('showFolderTree opens the drawer or shows the hidden pane, never hides it', () => {
    const store = usePanesStore.getState();
    store.setShell(shell({ style: 'bento', folderRoute: false }));
    showFolderTree();
    showFolderTree();
    expect(usePanesStore.getState().drawerOpen).toBe(true);
    store.setShell(shell({ style: 'bento', folderRoute: true }));
    usePanesStore.setState({ folderPaneCollapsed: true });
    showFolderTree();
    showFolderTree();
    expect(usePanesStore.getState().folderPaneCollapsed).toBe(false);
    store.setShell(shell({ style: 'calm' }));
    usePanesStore.setState({ leftCollapsed: true });
    showFolderTree();
    expect(usePanesStore.getState().leftCollapsed).toBe(false);
  });

  it('(F28.1) on phones Alt+2 opens the bottom sheet without touching the stored panel flag', () => {
    const store = usePanesStore.getState();
    store.setShell(shell({ style: 'calm', width: 'compact' }));
    store.toggleRight();
    expect(usePanesStore.getState()).toMatchObject({ sheetOpen: true, rightCollapsed: false });
    store.toggleRight();
    expect(usePanesStore.getState().sheetOpen).toBe(false);
    expect(localStorage.getItem('sb:vault-a:panes')).toBeNull();
  });
});
