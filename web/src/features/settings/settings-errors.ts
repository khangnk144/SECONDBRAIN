/**
 * What a failed Settings action says (design.md §7: what happened and what to do next). The
 * server names the problem in `details.reason`; anything unknown gets the general message.
 */
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { vaultRefusalReason } from '../../lib/api/vault-switch-api';

const SAVE_REASONS = new Set([
  'too-short',
  'too-long',
  'pattern',
  'out-of-range',
  'api-key-format',
  'unsupported-platform',
  'invalid-path',
  'shortcut-failed',
  'consent-required',
]);

/** A browser `fetch` that never reached the server. */
function isOffline(error: unknown): boolean {
  return error instanceof TypeError;
}

export function settingsSaveError(error: unknown): string {
  if (isOffline(error)) return i18n.t('settings.errors.offline');
  if (isApiError(error)) {
    const reason = error.details.reason;
    if (typeof reason === 'string' && SAVE_REASONS.has(reason)) {
      return i18n.t(`settings.errors.save.${reason}`);
    }
    if (error.code === 'WRITE_FAILED') return i18n.t('settings.errors.writeFailed');
  }
  return i18n.t('settings.errors.generic');
}

const VAULT_REASONS = new Set([
  'not-absolute',
  'not-found',
  'not-a-directory',
  'not-writable',
  'overlaps-app',
  'overlaps-vault',
  'open-failed',
  'switch-in-progress',
  'bad-archive',
  'unsafe-entry',
  'too-large',
  'target-not-empty',
  'target-inside-vault',
  'target-invalid',
  'bad-form',
]);

/** A refused vault switch, restore or export: the reason in words. */
export function vaultActionError(error: unknown): string {
  if (isOffline(error)) return i18n.t('settings.errors.offline');
  const reason = vaultRefusalReason(error);
  if (reason !== null && VAULT_REASONS.has(reason))
    return i18n.t(`settings.errors.vault.${reason}`);
  return i18n.t('settings.errors.generic');
}

/** A refused backup export: a vault too big for one zip says so, the rest like other actions. */
export function exportBackupError(error: unknown): string {
  return isApiError(error, 'VALIDATION') && error.details.reason === 'too-large'
    ? i18n.t('settings.vault.exportTooLarge')
    : vaultActionError(error);
}
