/**
 * Global settings sections added in M5 (SPEC F27 scheduled backups, F31 Telegram/email
 * reminders). Like the older sections, each normalizer keeps unknown keys and repairs missing or
 * invalid fields with defaults. Secrets (`backup.github.token`, `notify.telegram.botToken`,
 * `notify.email.password`) live only here, in `settings.json`: never returned in full, never
 * logged (see `storedSecretValues`), never in backups.
 */
import path from 'node:path';
import { REMINDER_TIME_PATTERN } from './settings-sections.js';

export type EmailSecurity = 'starttls' | 'tls' | 'none';
export const EMAIL_SECURITIES: readonly EmailSecurity[] = ['starttls', 'tls', 'none'];

export interface BackupScheduleSettings {
  enabled: boolean;
  /** Absolute folder for the zips; null = `<home>/Backups` (see `defaultBackupFolder`). */
  folder: string | null;
  /** Local time of day, `HH:mm`. */
  time: string;
  /** How many of the app's own scheduled backups to keep (`BACKUP_KEEP_MIN`…`BACKUP_KEEP_MAX`). */
  keep: number;
}

export interface BackupGithubSettings {
  enabled: boolean;
  /** `https://` remote of a private repository, without credentials; null = not set. */
  remoteUrl: string | null;
  branch: string;
  /** Secret: access token for the push. */
  token?: string;
}

export interface BackupSettings {
  schedule: BackupScheduleSettings;
  github: BackupGithubSettings;
}

export interface TelegramSettings {
  enabled: boolean;
  /** Numeric chat id (`-` for groups) or `@channelname`. */
  chatId: string | null;
  /** Secret: the bot token from @BotFather. */
  botToken?: string;
}

export interface EmailSettings {
  enabled: boolean;
  host: string | null;
  port: number;
  security: EmailSecurity;
  user: string | null;
  from: string | null;
  to: string | null;
  /** Secret: the SMTP password. */
  password?: string;
}

export interface NotifySettings {
  telegram: TelegramSettings;
  email: EmailSettings;
}

export const DEFAULT_BACKUP_TIME = '21:00';
export const DEFAULT_BACKUP_KEEP = 14;
export const BACKUP_KEEP_MIN = 3;
export const BACKUP_KEEP_MAX = 60;
export const DEFAULT_BACKUP_BRANCH = 'main';
export const DEFAULT_SMTP_PORT = 587;
/** Folder name of the default backup folder, next to the default vault. */
export const DEFAULT_BACKUP_FOLDER_NAME = 'Backups';

export const BACKUP_TIME_PATTERN = REMINDER_TIME_PATTERN;
/** Telegram chat ids: a (negative for groups) number, or a public `@channelname`. */
export const TELEGRAM_CHAT_ID_PATTERN = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;
/** One plain address (`ten@truong.edu.vn`); display names are not accepted. */
export const EMAIL_ADDRESS_PATTERN = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:".]+$/;
/** Host names and IPv4 addresses (no scheme, no port, no spaces). */
export const SMTP_HOST_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;
/** Branch names git accepts and a command line cannot mistake for an option. */
export const GIT_BRANCH_PATTERN =
  /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)[A-Za-z0-9._/-]{1,100}(?<![./])$/;

/** `<home>/Backups`: where scheduled backups go while `backup.schedule.folder` is null. */
export function defaultBackupFolder(home: string): string {
  return path.join(home, DEFAULT_BACKUP_FOLDER_NAME);
}

/**
 * A remote the push may use: `https://host/…` with no user name or password in it (a token in
 * the URL would end up in `.git/config` and in error messages). Returns the URL as given.
 */
export function isSafeRemoteUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 500 || /\s/.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.hostname !== '' && !url.username && !url.password;
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

const matching = (pattern: RegExp, value: unknown): string | null =>
  typeof value === 'string' && pattern.test(value) ? value : null;

const textOrNull = (value: unknown, max = 500): string | null =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max ? value : null;

/** Keeps a secret only when it is a non-empty string; anything else is dropped. */
function withSecret<T extends Record<string, unknown>>(target: T, key: string, value: unknown): T {
  if (typeof value === 'string' && value !== '') return { ...target, [key]: value };
  const { [key]: _dropped, ...rest } = target;
  return rest as T;
}

function inRange(value: unknown, min: number, max: number, fallback: number): number {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fallback;
}

export function normalizeBackup(raw: unknown): BackupSettings {
  const section = record(raw);
  const schedule = record(section.schedule);
  const github = record(section.github);
  const folder =
    typeof schedule.folder === 'string' && path.isAbsolute(schedule.folder)
      ? schedule.folder
      : null;
  return {
    ...section,
    schedule: {
      ...schedule,
      enabled: schedule.enabled === true,
      folder,
      time: matching(BACKUP_TIME_PATTERN, schedule.time) ?? DEFAULT_BACKUP_TIME,
      keep: inRange(schedule.keep, BACKUP_KEEP_MIN, BACKUP_KEEP_MAX, DEFAULT_BACKUP_KEEP),
    },
    github: withSecret(
      {
        ...github,
        enabled: github.enabled === true,
        remoteUrl: isSafeRemoteUrl(github.remoteUrl) ? github.remoteUrl : null,
        branch: matching(GIT_BRANCH_PATTERN, github.branch) ?? DEFAULT_BACKUP_BRANCH,
      },
      'token',
      github.token,
    ),
  };
}

export function normalizeNotify(raw: unknown): NotifySettings {
  const section = record(raw);
  const telegram = record(section.telegram);
  const email = record(section.email);
  return {
    ...section,
    telegram: withSecret(
      {
        ...telegram,
        enabled: telegram.enabled === true,
        chatId: matching(TELEGRAM_CHAT_ID_PATTERN, telegram.chatId),
      },
      'botToken',
      telegram.botToken,
    ),
    email: withSecret(
      {
        ...email,
        enabled: email.enabled === true,
        host: matching(SMTP_HOST_PATTERN, email.host),
        port: inRange(email.port, 1, 65_535, DEFAULT_SMTP_PORT),
        security: EMAIL_SECURITIES.includes(email.security as EmailSecurity)
          ? (email.security as EmailSecurity)
          : 'starttls',
        user: textOrNull(email.user, 320),
        from: matching(EMAIL_ADDRESS_PATTERN, email.from),
        to: matching(EMAIL_ADDRESS_PATTERN, email.to),
      },
      'password',
      email.password,
    ),
  };
}

/** The M5 secrets that are stored now (the logger redacts them; tests scan for them). */
export function storedM5Secrets(settings: {
  backup: BackupSettings;
  notify: NotifySettings;
}): string[] {
  return [
    settings.backup.github.token,
    settings.notify.telegram.botToken,
    settings.notify.email.password,
  ].filter((value): value is string => typeof value === 'string' && value !== '');
}
