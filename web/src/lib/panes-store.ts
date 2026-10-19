import { create } from 'zustand';
import { vaultStorage } from './vault-storage';

const STORAGE_KEY = 'panes';

interface StoredPanes {
  leftCollapsed?: unknown;
  rightCollapsed?: unknown;
}

interface PanesState {
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  toggleLeft: () => void;
  toggleRight: () => void;
  /** Reads the collapsed state saved for the current vault. */
  hydrate: () => void;
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
  toggleLeft: () => {
    set({ leftCollapsed: !get().leftCollapsed });
    save(get());
  },
  toggleRight: () => {
    set({ rightCollapsed: !get().rightCollapsed });
    save(get());
  },
  hydrate: () => {
    const stored = vaultStorage.get<StoredPanes | null>(STORAGE_KEY, null);
    set({
      leftCollapsed: stored?.leftCollapsed === true,
      rightCollapsed: stored?.rightCollapsed === true,
    });
  },
}));
