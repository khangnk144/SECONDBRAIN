import { create } from 'zustand';
import { vaultStorage } from './vault-storage';

const STORAGE_KEY = 'panes';
/** Bento's "Thư mục" pane has its own memory, so the calm sidebar preference is kept apart. */
const FOLDER_PANE_KEY = 'folder-pane';

interface StoredPanes {
  leftCollapsed?: unknown;
  rightCollapsed?: unknown;
}

/**
 * Window width classes of the shell: `wide` ≥ 1200 px, `medium` 960–1199 (bento: no folder pane
 * beside the note, it would leave the note too little room), `narrow` 601–959 (bento rail on
 * top), `compact` ≤ 600 px (phone layouts, both styles).
 */
export type ShellWidth = 'wide' | 'medium' | 'narrow' | 'compact';

/** Where the layout is now, set by the layout from the style, the route and the window width. */
export interface ShellContext {
  style: 'bento' | 'calm';
  /** A note or file route: bento shows the folder pane beside the rail there. */
  folderRoute: boolean;
  width: ShellWidth;
}

/**
 * What `Alt+1` controls: the calm left pane, bento's folder pane, or a drawer over the content
 * (bento away from note/file routes or below 1200 px; both styles at 600 px or less).
 */
export type LeftPaneMode = 'pane' | 'folder-pane' | 'drawer';

export function leftPaneMode(shell: ShellContext): LeftPaneMode {
  if (shell.width === 'compact') return 'drawer';
  if (shell.style === 'calm') return 'pane';
  return shell.folderRoute && shell.width === 'wide' ? 'folder-pane' : 'drawer';
}

interface PanesState {
  /** Stored preference (per vault). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /** Bento: the "Thư mục" pane on note and file routes is collapsed (stored per vault). */
  folderPaneCollapsed: boolean;
  /**
   * An immersive screen (the graph) is on screen: both panes start hidden there and the toggles
   * only change the session flags below, never the stored preference.
   */
  immersive: boolean;
  immersiveShowLeft: boolean;
  immersiveShowRight: boolean;
  /** Session only: the folder drawer (bento) or the sidebar drawer (calm, ≤ 600 px) is open. */
  drawerOpen: boolean;
  /** Session only (≤ 600 px): the right panel is open as a bottom sheet. */
  sheetOpen: boolean;
  shell: ShellContext;
  toggleLeft: () => void;
  toggleRight: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
  closeSheet: () => void;
  setShell: (shell: ShellContext) => void;
  /** Entering an immersive route hides both panes again; leaving it restores the preference. */
  setImmersive: (immersive: boolean) => void;
  /**
   * Reads the collapsed state saved for the current vault. A pane the user toggled before this
   * (Alt+1/Alt+2 while the app was still starting) keeps the state the user chose.
   */
  hydrate: () => void;
  /** The saved state has been read. */
  hydrated: boolean;
  /** Panes toggled before hydration, with the state the user left them in. */
  earlyToggles: {
    leftCollapsed?: boolean;
    rightCollapsed?: boolean;
    folderPaneCollapsed?: boolean;
  };
}

export const DEFAULT_SHELL: ShellContext = { style: 'calm', folderRoute: false, width: 'wide' };

function save(state: Pick<PanesState, 'leftCollapsed' | 'rightCollapsed'>) {
  vaultStorage.set(STORAGE_KEY, {
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
  });
}

function sameShell(a: ShellContext, b: ShellContext): boolean {
  return a.style === b.style && a.folderRoute === b.folderRoute && a.width === b.width;
}

/** Side panes collapsed or not (`Alt+1` left, `Alt+2` right), remembered per vault. */
export const usePanesStore = create<PanesState>((set, get) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  folderPaneCollapsed: false,
  immersive: false,
  immersiveShowLeft: false,
  immersiveShowRight: false,
  drawerOpen: false,
  sheetOpen: false,
  shell: DEFAULT_SHELL,
  hydrated: false,
  earlyToggles: {},
  toggleLeft: () => {
    const mode = leftPaneMode(get().shell);
    if (mode === 'drawer') return set({ drawerOpen: !get().drawerOpen });
    if (mode === 'folder-pane') {
      const folderPaneCollapsed = !get().folderPaneCollapsed;
      set({ folderPaneCollapsed });
      if (get().hydrated) vaultStorage.set(FOLDER_PANE_KEY, { collapsed: folderPaneCollapsed });
      else set({ earlyToggles: { ...get().earlyToggles, folderPaneCollapsed } });
      return;
    }
    if (get().immersive) return set({ immersiveShowLeft: !get().immersiveShowLeft });
    const leftCollapsed = !get().leftCollapsed;
    set({ leftCollapsed });
    if (get().hydrated) save(get());
    else set({ earlyToggles: { ...get().earlyToggles, leftCollapsed } });
  },
  toggleRight: () => {
    if (get().shell.width === 'compact') return set({ sheetOpen: !get().sheetOpen });
    if (get().immersive) return set({ immersiveShowRight: !get().immersiveShowRight });
    const rightCollapsed = !get().rightCollapsed;
    set({ rightCollapsed });
    if (get().hydrated) save(get());
    else set({ earlyToggles: { ...get().earlyToggles, rightCollapsed } });
  },
  openDrawer: () => set({ drawerOpen: true }),
  closeDrawer: () => {
    if (get().drawerOpen) set({ drawerOpen: false });
  },
  closeSheet: () => {
    if (get().sheetOpen) set({ sheetOpen: false });
  },
  setShell: (shell) => {
    if (!sameShell(get().shell, shell)) set({ shell });
  },
  setImmersive: (immersive) => {
    if (get().immersive === immersive) return;
    set({ immersive, immersiveShowLeft: false, immersiveShowRight: false });
  },
  hydrate: () => {
    const stored = vaultStorage.get<StoredPanes | null>(STORAGE_KEY, null);
    const folders = vaultStorage.get<{ collapsed?: unknown } | null>(FOLDER_PANE_KEY, null);
    const early = get().earlyToggles;
    set({
      leftCollapsed: early.leftCollapsed ?? stored?.leftCollapsed === true,
      rightCollapsed: early.rightCollapsed ?? stored?.rightCollapsed === true,
      folderPaneCollapsed: early.folderPaneCollapsed ?? folders?.collapsed === true,
      hydrated: true,
      earlyToggles: {},
    });
    // The early choice could not be saved yet (no vault id): it is the preference now.
    if (early.leftCollapsed !== undefined || early.rightCollapsed !== undefined) save(get());
    if (early.folderPaneCollapsed !== undefined) {
      vaultStorage.set(FOLDER_PANE_KEY, { collapsed: early.folderPaneCollapsed });
    }
  },
}));

export interface EffectivePanes {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}

/**
 * What is on screen: the stored preference, or on an immersive route the session flags.
 * `immersive` is passed by the layout (from the route handle) so the very first frame of the
 * graph already has the panes hidden.
 */
export function effectivePanes(state: PanesState, immersive = state.immersive): EffectivePanes {
  if (!immersive)
    return { leftCollapsed: state.leftCollapsed, rightCollapsed: state.rightCollapsed };
  // The store may not have caught up with the route yet (first frame): start hidden.
  const caughtUp = state.immersive;
  return {
    leftCollapsed: !(caughtUp && state.immersiveShowLeft),
    rightCollapsed: !(caughtUp && state.immersiveShowRight),
  };
}

/** Effective pane visibility for components (the toolbar buttons and the layout). */
export function useEffectivePanes(immersive?: boolean): EffectivePanes {
  const leftCollapsed = usePanesStore((s) => effectivePanes(s, immersive).leftCollapsed);
  const rightCollapsed = usePanesStore((s) => effectivePanes(s, immersive).rightCollapsed);
  return { leftCollapsed, rightCollapsed };
}

/**
 * Shows the folder tree wherever it lives in the current layout (e.g. "Dọn Inbox" without AI):
 * opens the drawer, or shows the collapsed folder pane / calm sidebar.
 */
export function showFolderTree(): void {
  const state = usePanesStore.getState();
  const mode = leftPaneMode(state.shell);
  if (mode === 'drawer') return state.openDrawer();
  const hidden =
    mode === 'folder-pane' ? state.folderPaneCollapsed : effectivePanes(state).leftCollapsed;
  if (hidden) state.toggleLeft();
}

/**
 * Shows the right panel wherever it lives (a calendar day just chosen): expands the collapsed
 * side pane, or on phones opens the bottom sheet (F28.1).
 */
export function showRightPanel(): void {
  const state = usePanesStore.getState();
  const hidden =
    state.shell.width === 'compact' ? !state.sheetOpen : effectivePanes(state).rightCollapsed;
  if (hidden) state.toggleRight();
}

/** Test helper: the session-only shell state back to its start (drawer and sheet closed). */
export function resetShellSession(): void {
  usePanesStore.setState({
    folderPaneCollapsed: false,
    drawerOpen: false,
    sheetOpen: false,
    shell: DEFAULT_SHELL,
  });
}
