/**
 * The browser's notification permission as a small store: read at start, re-read when the window
 * comes back into view (she may have changed it in the site settings), and asked for only from a
 * click (`requestNotificationPermission`, never on its own).
 */
import { create } from 'zustand';
import type { PermissionState } from './reminder-notifications';

export function readNotificationPermission(win: Window = window): PermissionState {
  try {
    const api = (win as Window & { Notification?: typeof Notification }).Notification;
    return api ? api.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

interface PermissionStore {
  permission: PermissionState;
  refresh: () => void;
}

export const useNotificationPermission = create<PermissionStore>((set) => ({
  permission: readNotificationPermission(),
  refresh: () => set({ permission: readNotificationPermission() }),
}));

/** Asks the browser (call it from a click handler only). Resolves with the new state. */
export async function requestNotificationPermission(): Promise<PermissionState> {
  const api = (window as Window & { Notification?: typeof Notification }).Notification;
  if (!api) return 'unsupported';
  try {
    await api.requestPermission();
  } catch {
    // Old browsers only take a callback; the state read below is what counts.
  }
  useNotificationPermission.getState().refresh();
  return useNotificationPermission.getState().permission;
}

/** Keeps the store current while the app runs; returns the stop function. */
export function startPermissionWatch(): () => void {
  const refresh = () => useNotificationPermission.getState().refresh();
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  refresh();
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
