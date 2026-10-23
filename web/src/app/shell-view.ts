import { effectivePanes, leftPaneMode, usePanesStore, type ShellContext } from '../lib/panes-store';

/** What the shell shows around the routed screen, for both styles. */
export interface ShellView {
  /** Calm: the left sidebar in the page. Bento: the folder pane beside the rail. */
  leftInline: boolean;
  /** The left drawer is open over the content (bento folder tree, calm sidebar on phones). */
  drawer: boolean;
  /** The right panel beside the screen, as a bottom sheet (phones) or not at all. */
  right: 'side' | 'sheet' | 'none';
}

/**
 * The visible state from the panes store: calm keeps its stored/immersive rules; bento's folder
 * pane has its own stored flag; drawers and the sheet are session flags (see `leftPaneMode`).
 */
export function useShellView(
  shell: ShellContext,
  route: { hasPanel: boolean; immersive: boolean },
): ShellView {
  const mode = leftPaneMode(shell);
  const leftInline = usePanesStore((state) => {
    if (mode === 'pane') return !effectivePanes(state, route.immersive).leftCollapsed;
    return mode === 'folder-pane' && !state.folderPaneCollapsed;
  });
  const drawer = usePanesStore((state) => mode === 'drawer' && state.drawerOpen);
  const compact = shell.width === 'compact';
  const rightOpen = usePanesStore((state) =>
    compact ? state.sheetOpen : !effectivePanes(state, route.immersive).rightCollapsed,
  );
  const right = !route.hasPanel || !rightOpen ? 'none' : compact ? 'sheet' : 'side';
  return { leftInline, drawer, right };
}
