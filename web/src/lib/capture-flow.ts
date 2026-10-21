/**
 * Quick capture (SPEC F12): the text becomes a new note in `0 Inbox` (the server picks the name),
 * a 4 s toast "Đã lưu vào Inbox" offers "Mở", and the tree refreshes so the Inbox count grows.
 */
import { i18n } from '../i18n';
import { postCapture } from './api/capture-daily-api';
import type { VaultPath } from './api/vault-types';
import { showOperationError } from './operation-errors';
import { useTabsStore } from './tabs-store';
import { showToast, TOAST_MS } from './toast-store';
import { useTreeStore } from './tree-store';

/** The server accepts 1–20 000 characters after trimming. */
export const MAX_CAPTURE_LENGTH = 20_000;

/** Saves `text` to the Inbox. Returns the new path, or null (nothing to save, or it failed). */
export async function captureToInbox(text: string): Promise<VaultPath | null> {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  // Counted in code points, so an emoji is one character as the server counts it.
  if ([...trimmed].length > MAX_CAPTURE_LENGTH) {
    showToast({
      message: i18n.t('operations.captureTooLong', { max: MAX_CAPTURE_LENGTH }),
      tone: 'error',
    });
    return null;
  }
  try {
    const created = await postCapture(text);
    useTreeStore.getState().scheduleRefresh();
    showToast({
      message: i18n.t('operations.captured'),
      // design.md §5: only toasts that carry "Hoàn tác" stay 10 s; "Mở" keeps the plain 4 s.
      durationMs: TOAST_MS,
      action: {
        label: i18n.t('operations.open'),
        run: () => useTabsStore.getState().openNote(created.path),
      },
    });
    return created.path;
  } catch (error) {
    showOperationError(error);
    return null;
  }
}
