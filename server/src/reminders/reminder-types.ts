import type { VaultPluginInstance } from '../app-context/vault-plugins.js';
import type { VaultPath } from '../vault/vault-types.js';

/** Days before the due date at which a deadline item is reminded (SPEC F17). */
export type ReminderThreshold = 3 | 1 | 0;

/** Outcome of the server's Windows toast for one reminder. */
export type ToastOutcome = 'shown' | 'failed' | 'unsupported';

/**
 * One reminder the server fired (or caught up after sleep/shutdown). Persisted in
 * `state/reminders.json` keyed by `key`; sent to clients in the `reminder` event and by
 * `GET /api/reminders`.
 */
export interface ReminderEntry {
  /** Dedupe key: `<vaultId>|<itemId>|<due>|<threshold>`; a reschedule gives a new key. */
  key: string;
  /** Deadline item id: `note:<path>` or `task:<path>#<line>`. */
  itemId: string;
  path: VaultPath;
  title: string;
  /** Due date, `YYYY-MM-DD` (local calendar date). */
  due: string;
  threshold: ReminderThreshold;
  /** When it fired, ISO instant. */
  firedAt: string;
  /** Delivered late (the machine was asleep/off or the server was not running at the time). */
  missed: boolean;
  toast: ToastOutcome;
  /** Dismissed in the app ("Bỏ qua"); dismissed entries are no longer listed. */
  dismissed: boolean;
}

/** The running reminders plugin of one vault (`context.plugin(REMINDERS_PLUGIN)`). */
export interface ReminderService extends VaultPluginInstance {
  /** What `GET /api/reminders` lists (call after `context.settled()`). */
  list(): ReminderEntry[];
  /** Dismisses the entries with these keys; unknown or already dismissed keys are ignored. */
  dismiss(keys: readonly string[]): Promise<number>;
  /** One evaluation now (queued behind a running one); resolves with the entries it fired. */
  runNow(): Promise<ReminderEntry[]>;
  /** The configured reminder time, `HH:mm`. */
  time(): string;
  /** Whether this machine can show server toasts (Windows). */
  readonly toastSupported: boolean;
}
