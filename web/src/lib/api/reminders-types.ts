/** `GET /api/reminders` and the `reminder` event, mirrored from `server/src/reminders/`. */
import type { VaultPath } from './vault-types';

export type ReminderThreshold = 3 | 1 | 0;
export type ToastOutcome = 'shown' | 'failed' | 'unsupported';

export interface ReminderEntry {
  /** Dedupe key (`<vaultId>|<itemId>|<due>|<threshold>`). */
  key: string;
  itemId: string;
  path: VaultPath;
  title: string;
  /** `YYYY-MM-DD`, local calendar date. */
  due: string;
  threshold: ReminderThreshold;
  /** ISO instant it fired. */
  firedAt: string;
  /** Delivered late (asleep, switched off, server not running at the time). */
  missed: boolean;
  /** The server's Windows toast for it. */
  toast: ToastOutcome;
  dismissed: boolean;
}

export interface RemindersResponse {
  /** False when the reminders service is not running for this vault. */
  available: boolean;
  /** Configured reminder time, `HH:mm`. */
  time: string;
  toastSupported: boolean;
  /** Newest first. */
  reminders: ReminderEntry[];
}
