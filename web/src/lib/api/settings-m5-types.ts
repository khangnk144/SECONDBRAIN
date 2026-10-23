/**
 * The M5 sections of `GET/PUT /api/settings` (F27 scheduled backups, F31 reminder channels),
 * mirrored by hand from `server/src/config/settings-response-m5.ts`, `settings-patch-m5.ts` and
 * `settings-sections-m5.ts`. Secrets are only ever answered as `{ set, last4 }`.
 */
import type { ApiKeyStatus } from './settings-types';

export type EmailSecurity = 'starttls' | 'tls' | 'none';
export const EMAIL_SECURITIES: readonly EmailSecurity[] = ['starttls', 'tls', 'none'];

/** `backup.schedule.keep` bounds and the other server defaults. */
export const BACKUP_KEEP_MIN = 3;
export const BACKUP_KEEP_MAX = 60;
export const DEFAULT_BACKUP_TIME = '21:00';
export const DEFAULT_BACKUP_KEEP = 14;
export const DEFAULT_SMTP_PORT = 587;

export interface BackupSettingsView {
  schedule: {
    enabled: boolean;
    /** Absolute folder; null = the default folder below. */
    folder: string | null;
    /** `HH:mm`, local time. */
    time: string;
    keep: number;
    /** `<home>/Backups`; null without a vault. */
    defaultFolder: string | null;
  };
  github: {
    enabled: boolean;
    /** `https://` remote without credentials, or null. */
    remoteUrl: string | null;
    branch: string;
    token: ApiKeyStatus;
  };
}

export interface NotifySettingsView {
  telegram: { enabled: boolean; chatId: string | null; botToken: ApiKeyStatus };
  email: {
    enabled: boolean;
    host: string | null;
    port: number;
    security: EmailSecurity;
    user: string | null;
    from: string | null;
    to: string | null;
    password: ApiKeyStatus;
  };
}

/**
 * `PUT /api/settings` fields for these sections. Nullable text: `''` or `null` clears it.
 * Secrets (`token`, `botToken`, `password`): a string sets it, `null` removes it. Refusals are
 * 400 `VALIDATION` with `details.field` (e.g. `backup.schedule.keep`) and `details.reason`:
 * `pattern`, `out-of-range`, `type`, `not-allowed`, `not-absolute`, `invalid-path`, `https-only`,
 * `credentials-in-url`, `branch-format`, `token-format`, `chat-id-format`, `bot-token-format`,
 * `host-format`, `email-format`, `control-characters`, `too-short`, `too-long`, `unknown-field`.
 */
export interface SettingsPatchM5 {
  backup?: {
    schedule?: { enabled?: boolean; folder?: string | null; time?: string; keep?: number };
    github?: {
      enabled?: boolean;
      remoteUrl?: string | null;
      branch?: string;
      token?: string | null;
    };
  };
  notify?: {
    telegram?: { enabled?: boolean; chatId?: string | null; botToken?: string | null };
    email?: {
      enabled?: boolean;
      host?: string | null;
      port?: number;
      security?: EmailSecurity;
      user?: string | null;
      from?: string | null;
      to?: string | null;
      password?: string | null;
    };
  };
}
