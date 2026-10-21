/**
 * Which note's history is open (the dialog has no route: it sits over whatever is on screen).
 * `restores` counts finished restores so the right-pane section refetches its list.
 */
import { create } from 'zustand';
import type { VaultPath } from '../../lib/api/vault-types';

interface HistoryDialogState {
  path: VaultPath | null;
  /** Commit to select first (from the right-pane list); null = the newest. */
  commit: string | null;
  restores: number;
  open: (path: VaultPath, commit?: string | null) => void;
  close: () => void;
  restored: () => void;
}

export const useHistoryDialog = create<HistoryDialogState>((set, get) => ({
  path: null,
  commit: null,
  restores: 0,
  open: (path, commit = null) => set({ path, commit }),
  close: () => set({ path: null, commit: null }),
  restored: () => set({ restores: get().restores + 1 }),
}));

let mountedHosts = 0;

/** A `HistoryDialogHost` is on the page (called by the host itself); returns its unregister. */
export function registerHistoryHost(): () => void {
  mountedHosts += 1;
  return () => {
    mountedHosts -= 1;
  };
}

export function historyHostMounted(): boolean {
  return mountedHosts > 0;
}
