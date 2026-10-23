/**
 * The client view of the M5 sections, built field by field (never a spread), so a secret can
 * never reach a response: each one is answered as `{ set, last4 }` only.
 */
import path from 'node:path';
import type { ApiKeyStatus } from './settings-response.js';
import {
  defaultBackupFolder,
  type BackupSettings,
  type EmailSettings,
  type NotifySettings,
  type TelegramSettings,
  type BackupGithubSettings,
  type BackupScheduleSettings,
} from './settings-sections-m5.js';

export interface BackupResponse {
  schedule: BackupScheduleSettings & {
    /** `<home>/Backups`, used while `folder` is null; null without a vault (tests). */
    defaultFolder: string | null;
  };
  github: Omit<BackupGithubSettings, 'token'> & { token: ApiKeyStatus };
}

export interface NotifyResponse {
  telegram: Omit<TelegramSettings, 'botToken'> & { botToken: ApiKeyStatus };
  email: Omit<EmailSettings, 'password'> & { password: ApiKeyStatus };
}

export function publicBackup(
  backup: BackupSettings,
  mask: (secret: unknown) => ApiKeyStatus,
  /** `<home>/vault` (the default vault path), from which the default backup folder follows. */
  defaultVaultPath: string | null,
): BackupResponse {
  const { schedule, github } = backup;
  return {
    schedule: {
      enabled: schedule.enabled,
      folder: schedule.folder,
      time: schedule.time,
      keep: schedule.keep,
      defaultFolder: defaultVaultPath ? defaultBackupFolder(path.dirname(defaultVaultPath)) : null,
    },
    github: {
      enabled: github.enabled,
      remoteUrl: github.remoteUrl,
      branch: github.branch,
      token: mask(github.token),
    },
  };
}

export function publicNotify(
  notify: NotifySettings,
  mask: (secret: unknown) => ApiKeyStatus,
): NotifyResponse {
  const { telegram, email } = notify;
  return {
    telegram: {
      enabled: telegram.enabled,
      chatId: telegram.chatId,
      botToken: mask(telegram.botToken),
    },
    email: {
      enabled: email.enabled,
      host: email.host,
      port: email.port,
      security: email.security,
      user: email.user,
      from: email.from,
      to: email.to,
      password: mask(email.password),
    },
  };
}
