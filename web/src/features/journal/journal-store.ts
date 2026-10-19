import { create } from 'zustand';
import { i18n } from '../../i18n';
import { journalConflictCount, journalConflictPaths } from '../../lib/api-client';
import { getPendingJournal, postJournalComplete } from '../../lib/api/journal-api';
import type { PendingJournalEntry } from '../../lib/api/journal-types';
import { showOperationError } from '../../lib/operation-errors';
import { showToast } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { conflictMessage, undoJournal } from '../../lib/undo-toast';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';

interface JournalState {
  /** Operations that did not finish (crash, failed rollback): offered "Hoàn tất" / "Hoàn tác". */
  entries: PendingJournalEntry[];
  busyId: string | null;
  setEntries: (entries: PendingJournalEntry[]) => void;
  fetchPending: () => Promise<void>;
  complete: (id: string) => Promise<void>;
  undo: (id: string) => Promise<void>;
}

export const useJournalStore = create<JournalState>((set, get) => ({
  entries: [],
  busyId: null,
  setEntries: (entries) => set({ entries }),
  fetchPending: async () => {
    try {
      set({ entries: (await getPendingJournal()).entries });
    } catch {
      // The banner simply stays as it was; the next event or reconnect refreshes it.
    }
  },
  complete: async (id) => {
    set({ busyId: id });
    try {
      await postJournalComplete(id);
      showToast({ message: i18n.t('journal.completed') });
    } catch (error) {
      const count = journalConflictCount(error);
      if (count !== null) {
        const paths = journalConflictPaths(error) ?? [];
        showToast({ message: conflictMessage('complete', paths, count), tone: 'error' });
      } else showOperationError(error);
    } finally {
      set({ busyId: null });
      useTreeStore.getState().scheduleRefresh();
      await get().fetchPending();
    }
  },
  undo: async (id) => {
    set({ busyId: id });
    try {
      await undoJournal(id);
    } finally {
      set({ busyId: null });
      await get().fetchPending();
    }
  },
}));

/** Pending entries arrive with every WS connection and after each operation; refetch on resync. */
export function startJournalSync(): () => void {
  const unsubscribers = [
    subscribeServerEvent('journal:pending', (event) =>
      useJournalStore.getState().setEntries(event.entries),
    ),
    subscribeServerEvent('resync', () => void useJournalStore.getState().fetchPending()),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
