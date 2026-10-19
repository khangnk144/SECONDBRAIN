/** Toasts for what the note session reports (design.md §7: what happened, what to do next). */
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { operationErrorMessage } from '../../lib/operation-errors';
import { showToast } from '../../lib/toast-store';
import type { SessionNotice } from './note-session-types';

const PATCH_REASONS = new Set([
  'invalid-yaml',
  'duplicate-key',
  'not-mapping',
  'invalid-key',
  'unsupported-value',
]);

function patchErrorMessage(error: unknown): string {
  if (isApiError(error, 'VALIDATION')) {
    const reason = error.details.reason;
    if (typeof reason === 'string' && PATCH_REASONS.has(reason)) {
      return i18n.t(`note.notices.patch.${reason}`);
    }
  }
  return operationErrorMessage(error);
}

export function showSessionNotice(notice: SessionNotice): void {
  switch (notice.kind) {
    case 'reloaded':
      showToast({ message: i18n.t('note.notices.reloaded') });
      return;
    case 'kept-mine':
      showToast({ message: i18n.t('note.notices.keptMine') });
      return;
    case 'kept-discarded':
      showToast({ message: i18n.t('note.notices.keptDiscarded') });
      return;
    case 'keep-aside-failed':
      showToast({ message: i18n.t('note.notices.keepAsideFailed'), tone: 'error' });
      return;
    case 'disk-changed-again':
      showToast({ message: i18n.t('note.notices.diskChangedAgain'), tone: 'error' });
      return;
    case 'action-failed':
      showToast({ message: operationErrorMessage(notice.error), tone: 'error' });
      return;
    case 'patch-failed':
      showToast({ message: patchErrorMessage(notice.error), tone: 'error' });
      return;
  }
}
