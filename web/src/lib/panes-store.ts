import { create } from 'zustand';
import { vaultStorage } from './vault-storage';

const STORAGE_KEY = 'panes';

interface StoredPanes {
  leftCollapsed?: unknown;
  rightCollapsed?: unknown;
}

interface PanesState {
  /** Stored preference (per vault). */
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  /**
   * An immersive screen (the graph) is on screen: both panes start hidden there and the toggles
   * only change the session flags below, never the stored preference.
   */
  immersive: boolean;
  immersiveShowLeft: boolean;
  immersiveShowRight: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
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
  earlyToggles: { leftCollapsed?: boolean; rightCollapsed?: boolean };
}

function save(state: Pick<PanesState, 'leftCollapsed' | 'rightCollapsed'>) {
  vaultStorage.set(STORAGE_KEY, {
    leftCollapsed: state.leftCollapsed,
    rightCollapsed: state.rightCollapsed,
  });
}

/** Side panes collapsed or not (`Alt+1` left, `Alt+2` right), remembered per vault. */
export const usePanesStore = create<PanesState>((set, get) => ({
  leftCollapsed: false,
  rightCollapsed: false,
  immersive: false,
  immersiveShowLeft: false,
  immersiveShowRight: false,
  hydrated: false,
  earlyToggles: {},
  toggleLeft: () => {
    if (get().immersive) return set({ immersiveShowLeft: !get().immersiveShowLeft });
    const leftCollapsed = !get().leftCollapsed;
    set({ leftCollapsed });
    if (get().hydrated) save(get());
    else set({ earlyToggles: { ...get().earlyToggles, leftCollapsed } });
  },
  toggleRight: () => {
    if (get().immersive) return set({ immersiveShowRight: !get().immersiveShowRight });
    const rightCollapsed = !get().rightCollapsed;
    set({ rightCollapsed });
    if (get().hydrated) save(get());
    else set({ earlyToggles: { ...get().earlyToggles, rightCollapsed } });
  },
  setImmersive: (immersive) => {
    if (get().immersive === immersive) return;
    set({ immersive, immersiveShowLeft: false, immersiveShowRight: false });
  },
  hydrate: () => {
    const stored = vaultStorage.get<StoredPanes | null>(STORAGE_KEY, null);
    const early = get().earlyToggles;
    set({
      leftCollapsed: early.leftCollapsed ?? stored?.leftCollapsed === true,
      rightCollapsed: early.rightCollapsed ?? stored?.rightCollapsed === true,
      hydrated: true,
      earlyToggles: {},
    });
    // The early choice could not be saved yet (no vault id): it is the preference now.
    if (early.leftCollapsed !== undefined || early.rightCollapsed !== undefined) save(get());
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
