/**
 * Test helper: what the real `PUT /api/settings` does to the M5 sections, for the fake settings
 * server of `settings-test-kit.tsx` (no validation: tests of refusals answer 400 themselves).
 * Secrets come back as `{ set, last4 }` like on the server (last 4 only from 16 characters on).
 */
import type {
  ApiKeyStatus,
  BackupSettingsView,
  NotifySettingsView,
  SettingsPatchM5,
} from '../../lib/api/settings-types';

const SECRET_KEYS = new Set(['token', 'botToken', 'password']);

export function maskedSecret(value: string | null): ApiKeyStatus {
  if (value === null || value === '') return { set: false, last4: null };
  return { set: true, last4: value.length >= 16 ? `…${value.slice(-4)}` : null };
}

function merge(target: Record<string, unknown>, changes: object | undefined): void {
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value === undefined) continue;
    if (SECRET_KEYS.has(key)) target[key] = maskedSecret(value as string | null);
    else target[key] = value === '' ? null : value;
  }
}

export function applyM5Patch(
  view: { backup: BackupSettingsView; notify: NotifySettingsView },
  patch: SettingsPatchM5,
): void {
  merge(view.backup.schedule as unknown as Record<string, unknown>, patch.backup?.schedule);
  merge(view.backup.github as unknown as Record<string, unknown>, patch.backup?.github);
  merge(view.notify.telegram as unknown as Record<string, unknown>, patch.notify?.telegram);
  merge(view.notify.email as unknown as Record<string, unknown>, patch.notify?.email);
}
