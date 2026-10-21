/**
 * State shared by the calendar screen and its right pane: the month view the screen shows (so
 * the pane lists the opened day from the same data and sees an optimistic move at once) and the
 * "Bao gồm Archive" toggle, remembered per vault. The month and the opened day live in the URL.
 */
import { create } from 'zustand';
import type { CalendarView } from '../../lib/api/deadlines-types';
import { vaultStorage } from '../../lib/vault-storage';
import { useVaultStore } from '../../lib/vault-store';

export const INCLUDE_ARCHIVE_KEY = 'calendar.includeArchive';

/** What the screen publishes about the month on screen. */
export interface SharedCalendarView {
  /** Null until the first answer. */
  view: CalendarView | null;
  /** Loading failed and there is nothing to show. */
  failed: boolean;
  refresh: () => Promise<void>;
  mutate: (update: (view: CalendarView) => CalendarView) => void;
}

/** The user opened a day in the grid: the pane shows it (and scrolls into view when stacked). */
export interface RevealRequest {
  day: string;
  seq: number;
}

interface CalendarState {
  shared: SharedCalendarView | null;
  /** The toggle as set in this window, by vault id (the stored value is read otherwise). */
  archiveByVault: Record<string, boolean>;
  reveal: RevealRequest | null;
  publish: (shared: SharedCalendarView | null) => void;
  setIncludeArchive: (value: boolean) => void;
  requestReveal: (day: string) => void;
}

export const useCalendarStore = create<CalendarState>((set, get) => ({
  shared: null,
  archiveByVault: {},
  reveal: null,
  publish: (shared) => set({ shared }),
  requestReveal: (day) => set({ reveal: { day, seq: (get().reveal?.seq ?? 0) + 1 } }),
  setIncludeArchive: (value) => {
    const vaultId = useVaultStore.getState().vaultId;
    if (vaultId === null) return;
    vaultStorage.set(INCLUDE_ARCHIVE_KEY, value);
    set({ archiveByVault: { ...get().archiveByVault, [vaultId]: value } });
  },
}));

/** Whether archived items are listed (the toggle), for the vault open in this window. */
export function useIncludeArchive(): boolean {
  const vaultId = useVaultStore((s) => s.vaultId);
  const chosen = useCalendarStore((s) =>
    vaultId === null ? undefined : s.archiveByVault[vaultId],
  );
  return chosen ?? vaultStorage.get<unknown>(INCLUDE_ARCHIVE_KEY, false) === true;
}

/** Test helper: forgets the shared view and the toggles set in this window. */
export function resetCalendarStore(): void {
  useCalendarStore.setState({ shared: null, archiveByVault: {}, reveal: null });
}
