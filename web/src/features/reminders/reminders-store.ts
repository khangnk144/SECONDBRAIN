/**
 * The in-app reminders list (SPEC F17: "listed under Nhắc nhở"), shared by the screen and the
 * sidebar badge. It refetches when a reminder fires, after a reconnect, when vault files change
 * (a ticked or rescheduled item leaves the list) and when the window comes back into view
 * (dismissing sends no event, so another window's "Bỏ qua" shows up on the next focus).
 */
import { create } from 'zustand';
import { i18n } from '../../i18n';
import { dismissReminders, getReminders } from '../../lib/api/reminders-api';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import { debounce } from '../../lib/debounce';
import { showToast } from '../../lib/toast-store';
import { invalidatesVaultData } from '../../lib/use-live-query';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';

export const REMINDERS_REFRESH_DEBOUNCE_MS = 150;

export type RemindersStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RemindersState {
  status: RemindersStatus;
  /** False when the reminders service is not running for this vault. */
  available: boolean;
  /** Configured reminder time, `HH:mm`; null until the server said it (never a guessed default). */
  time: string | null;
  toastSupported: boolean;
  reminders: ReminderEntry[];
  load: () => Promise<void>;
  /** "Bỏ qua" (one) and "Bỏ qua tất cả": removed at once, put back if the server refuses. */
  dismiss: (keys: readonly string[]) => Promise<boolean>;
}

let loadSeq = 0;

export const useRemindersStore = create<RemindersState>((set, get) => ({
  status: 'idle',
  available: true,
  time: null,
  toastSupported: false,
  reminders: [],
  load: async () => {
    const seq = ++loadSeq;
    if (get().status === 'idle') set({ status: 'loading' });
    try {
      const answer = await getReminders();
      if (seq !== loadSeq) return;
      set({
        status: 'ready',
        available: answer.available,
        time: answer.time,
        toastSupported: answer.toastSupported,
        reminders: answer.reminders.filter((entry) => !entry.dismissed),
      });
    } catch {
      if (seq !== loadSeq) return;
      // A failed refetch keeps what is on screen; only a first load shows the error.
      if (get().status !== 'ready') set({ status: 'error' });
    }
  },
  dismiss: async (keys) => {
    const gone = new Set(keys);
    const before = get().reminders;
    loadSeq += 1; // an older answer must not bring the dismissed rows back
    set({ reminders: before.filter((entry) => !gone.has(entry.key)) });
    try {
      await dismissReminders([...gone]);
      return true;
    } catch {
      set({ reminders: before });
      showToast({ message: i18n.t('reminders.dismissFailed'), tone: 'error' });
      return false;
    }
  },
}));

/** Number shown on the sidebar badge. */
export function useReminderCount(): number {
  return useRemindersStore((state) => state.reminders.length);
}

/** Keeps the list current; returns the stop function. */
export function startRemindersSync(): () => void {
  const debounced = debounce(
    () => void useRemindersStore.getState().load(),
    REMINDERS_REFRESH_DEBOUNCE_MS,
  );
  const refresh = () => debounced.schedule();
  const stops = [
    subscribeServerEvent('reminder', refresh),
    subscribeServerEvent('*', (event) => {
      if (invalidatesVaultData(event)) refresh();
    }),
  ];
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stops.forEach((stop) => stop());
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisible);
    debounced.cancel();
  };
}

/** Test helper. */
export function resetReminders(): void {
  loadSeq += 1;
  useRemindersStore.setState({
    status: 'idle',
    available: true,
    time: null,
    toastSupported: false,
    reminders: [],
  });
}
