/**
 * "Đã mở kho …" after a switch or a restore (design.md §7: an action says it worked). The page
 * reloads into the other vault, so the message waits in sessionStorage (this tab only) and the
 * new page shows it once.
 */
import { i18n } from '../../i18n';
import { showToast } from '../../lib/toast-store';

const STORAGE_KEY = 'sb:vault-opened';

export interface VaultOpenedNotice {
  kind: 'switched' | 'restored';
  /** Absolute folder of the vault that is open after the reload. */
  path: string;
}

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Called before the switch request: the server's `vault:switched` event may reload the page
 * before the request itself has answered.
 */
export function rememberVaultOpened(notice: VaultOpenedNotice): void {
  try {
    session()?.setItem(STORAGE_KEY, JSON.stringify(notice));
  } catch {
    // Blocked storage: the switch still works, only the confirmation is skipped.
  }
}

/** The switch was refused (or the vault was open already): nothing to confirm. */
export function forgetVaultOpened(): void {
  try {
    session()?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored when storage is blocked.
  }
}

function takeNotice(): VaultOpenedNotice | null {
  const storage = session();
  try {
    const raw = storage?.getItem(STORAGE_KEY) ?? null;
    if (raw === null) return null;
    storage?.removeItem(STORAGE_KEY);
    const value = JSON.parse(raw) as Partial<VaultOpenedNotice>;
    if (typeof value.path !== 'string' || value.path === '') return null;
    return { kind: value.kind === 'restored' ? 'restored' : 'switched', path: value.path };
  } catch {
    return null;
  }
}

/** At start: the toast for a switch made just before the reload (shown once). */
export function showVaultOpenedNotice(): void {
  const notice = takeNotice();
  if (!notice) return;
  const key =
    notice.kind === 'restored' ? 'settings.vault.restoredNotice' : 'settings.vault.openedNotice';
  showToast({ message: i18n.t(key, { path: notice.path }) });
}
