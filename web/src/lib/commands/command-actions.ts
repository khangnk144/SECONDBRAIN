/**
 * What palette commands do when they are not a plain navigation: run an app shortcut's own action
 * (so a command and its key can never drift apart), trigger a shortcut a screen registered, and
 * start an index rebuild.
 */
import { i18n } from '../../i18n';
import { api } from '../api';
import { isApiError } from '../api-client';
import { showOperationError } from '../operation-errors';
import { parseKeys } from '../shortcuts/shortcut-keys';
import { listShortcuts } from '../shortcuts/shortcut-registry';
import { APP_SHORTCUTS, type AppShortcutId } from '../shortcuts/use-app-shortcuts';
import { showToast } from '../toast-store';
import { subscribeServerEvent } from '../ws/server-event-bus';

/** Runs the action bound to an app-wide shortcut. */
export function runAppShortcut(id: AppShortcutId): void {
  APP_SHORTCUTS.find((shortcut) => shortcut.id === id)?.run();
}

export function isShortcutRegistered(id: string): boolean {
  return listShortcuts().some((shortcut) => shortcut.id === id);
}

/** Keys of a registered shortcut (screen-level ones first, then the app-wide list), or null. */
export function registeredKeys(id: string): string | null {
  const registered = listShortcuts().find((shortcut) => shortcut.id === id);
  if (registered) return registered.keys;
  return APP_SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? null;
}

/**
 * Presses a shortcut that a screen registered (source mode belongs to the note screen, which keeps
 * its handler private): the key goes through the registry exactly as if typed, so the screen's
 * own checks (a conflict blocks source mode) still apply. Returns false when nothing is bound.
 */
export function triggerRegisteredShortcut(id: string): boolean {
  const keys = listShortcuts().find((shortcut) => shortcut.id === id)?.keys;
  if (!keys) return false;
  const parsed = parseKeys(keys);
  const key = parsed.key.length === 1 ? parsed.key : parsed.key.toUpperCase();
  window.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      code: /^[a-z]$/.test(parsed.key) ? `Key${parsed.key.toUpperCase()}` : '',
      ctrlKey: parsed.ctrl,
      altKey: parsed.alt,
      shiftKey: parsed.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

/** A rebuild of a large vault takes seconds; stop waiting for its end after this long. */
const REBUILD_WATCH_MS = 10 * 60_000;

/**
 * "Xây lại chỉ mục": the server answers 202 at once and rebuilds in the background (search keeps
 * working on the old index); a second toast says when the new index is in place.
 */
export async function rebuildIndex(): Promise<void> {
  try {
    await api().request('/index/rebuild', { method: 'POST' });
  } catch (error) {
    if (isApiError(error, 'CONFLICT')) {
      showToast({ message: i18n.t('commands.rebuildRunning') });
    } else {
      showOperationError(error);
    }
    return;
  }
  showToast({ message: i18n.t('commands.rebuildStarted') });
  const stop = subscribeServerEvent('index:progress', (event) => {
    if (event.phase !== 'done') return;
    finish();
    showToast({ message: i18n.t('commands.rebuildDone') });
  });
  const timer = setTimeout(() => finish(), REBUILD_WATCH_MS);
  function finish() {
    stop();
    clearTimeout(timer);
  }
}
