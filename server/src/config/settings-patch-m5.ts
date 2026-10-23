/**
 * The M5 part of `PUT /api/settings`: scheduled backups (F27) and reminder channels (F31).
 * Strings are trimmed, `''` clears a nullable field, and secrets are set by sending a string and
 * removed by sending `null`; they are never echoed, not even in an error (the message names the
 * field and the reason only).
 */
import path from 'node:path';
import type { BodySchema } from '../http/strict-body-schema.js';
import { bodyValidationError } from '../http/strict-body-schema.js';
import { isLoopbackHostName } from '../lib/loopback-host.js';
import type { VaultError } from '../vault/vault-types.js';
import type { GlobalSettings } from './global-settings.js';
import {
  BACKUP_KEEP_MAX,
  BACKUP_KEEP_MIN,
  BACKUP_TIME_PATTERN,
  EMAIL_ADDRESS_PATTERN,
  EMAIL_SECURITIES,
  GIT_BRANCH_PATTERN,
  SMTP_HOST_PATTERN,
  TELEGRAM_CHAT_ID_PATTERN,
  type EmailSecurity,
} from './settings-sections-m5.js';

export interface SettingsPatchM5 {
  backup?: {
    schedule?: { enabled?: boolean; folder?: string | null; time?: string; keep?: number };
    github?: {
      enabled?: boolean;
      remoteUrl?: string | null;
      branch?: string;
      /** Secret: a string sets it, `null` removes it. */
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

const section = (properties: Record<string, BodySchema>): BodySchema => ({
  type: 'object',
  additionalProperties: false,
  properties,
});
const nullable = (maxLength: number): BodySchema => ({ type: ['string', 'null'], maxLength });
const flag: BodySchema = { type: 'boolean' };

/** Schema fragments merged into `SETTINGS_PATCH_SCHEMA`. */
export const M5_PATCH_PROPERTIES: Record<string, BodySchema> = {
  backup: section({
    schedule: section({
      enabled: flag,
      folder: nullable(1024),
      time: { type: 'string', pattern: BACKUP_TIME_PATTERN.source },
      keep: { type: 'integer', minimum: BACKUP_KEEP_MIN, maximum: BACKUP_KEEP_MAX },
    }),
    github: section({
      enabled: flag,
      remoteUrl: nullable(500),
      branch: { type: 'string', maxLength: 100 },
      token: nullable(512),
    }),
  }),
  notify: section({
    telegram: section({ enabled: flag, chatId: nullable(64), botToken: nullable(256) }),
    email: section({
      enabled: flag,
      host: nullable(253),
      port: { type: 'integer', minimum: 1, maximum: 65_535 },
      security: { type: 'string', enum: EMAIL_SECURITIES },
      user: nullable(320),
      from: nullable(320),
      to: nullable(320),
      password: nullable(512),
    }),
  }),
};

/** Printable ASCII without spaces (access tokens). */
const TOKEN = /^[\x21-\x7e]{8,512}$/;
/** `123456789:AA…` as @BotFather hands it out. */
const BOT_TOKEN = /^\d{3,20}:[A-Za-z0-9_-]{20,100}$/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

const fieldError = (field: string, reason: string): VaultError =>
  bodyValidationError({ field, reason });

type Cleaner = (value: string, field: string) => string;

/** Trims a nullable text field in place; `''` becomes null, anything else goes through `check`. */
function cleanNullable<T extends Record<string, unknown>>(
  target: T,
  key: keyof T & string,
  field: string,
  check: Cleaner = (value) => value,
): void {
  const value = target[key];
  if (typeof value !== 'string') return;
  const trimmed = value.trim();
  (target as Record<string, unknown>)[key] = trimmed === '' ? null : check(trimmed, field);
}

const requirePattern =
  (pattern: RegExp, reason: string): Cleaner =>
  (value, field) => {
    if (!pattern.test(value)) throw fieldError(field, reason);
    return value;
  };

function absoluteFolder(value: string, field: string): string {
  if (value.includes('\0') || CONTROL.test(value)) throw fieldError(field, 'invalid-path');
  if (!path.isAbsolute(value)) throw fieldError(field, 'not-absolute');
  return value;
}

function remoteUrl(value: string, field: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw fieldError(field, 'https-only');
  }
  if (url.protocol !== 'https:' || url.hostname === '' || /\s/.test(value))
    throw fieldError(field, 'https-only');
  if (url.username || url.password) throw fieldError(field, 'credentials-in-url');
  return value;
}

function plainText(value: string, field: string): string {
  if (CONTROL.test(value)) throw fieldError(field, 'control-characters');
  return value.normalize('NFC');
}

/** Validates and cleans the M5 sections of a parsed patch in place; throws 400 `VALIDATION`. */
export function cleanM5Patch(patch: SettingsPatchM5): void {
  const schedule = patch.backup?.schedule;
  if (schedule) cleanNullable(schedule, 'folder', 'backup.schedule.folder', absoluteFolder);
  const github = patch.backup?.github;
  if (github) {
    cleanNullable(github, 'remoteUrl', 'backup.github.remoteUrl', remoteUrl);
    if (github.branch !== undefined) {
      github.branch = requirePattern(GIT_BRANCH_PATTERN, 'branch-format')(
        github.branch.trim(),
        'backup.github.branch',
      );
    }
    cleanNullable(github, 'token', 'backup.github.token', requirePattern(TOKEN, 'token-format'));
  }
  const telegram = patch.notify?.telegram;
  if (telegram) {
    const chatId = requirePattern(TELEGRAM_CHAT_ID_PATTERN, 'chat-id-format');
    cleanNullable(telegram, 'chatId', 'notify.telegram.chatId', chatId);
    const botToken = requirePattern(BOT_TOKEN, 'bot-token-format');
    cleanNullable(telegram, 'botToken', 'notify.telegram.botToken', botToken);
  }
  const email = patch.notify?.email;
  if (email) {
    cleanNullable(
      email,
      'host',
      'notify.email.host',
      requirePattern(SMTP_HOST_PATTERN, 'host-format'),
    );
    cleanNullable(email, 'user', 'notify.email.user', plainText);
    const address = requirePattern(EMAIL_ADDRESS_PATTERN, 'email-format');
    cleanNullable(email, 'from', 'notify.email.from', address);
    cleanNullable(email, 'to', 'notify.email.to', address);
    // Passwords keep their inner spaces (Gmail app passwords have them); only ends are trimmed.
    if (typeof email.password === 'string') {
      const password = email.password.trim();
      if (password === '') throw fieldError('notify.email.password', 'too-short');
      email.password = plainText(password, 'notify.email.password');
    }
  }
}

/** Copies every field the patch names; a secret set to `null` is removed from the file. */
function assignFields(target: Record<string, unknown>, changes: object | undefined): void {
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (value === undefined) continue;
    if (value === null && SECRET_KEYS.has(key)) delete target[key];
    else target[key] = value;
  }
}
const SECRET_KEYS = new Set(['token', 'botToken', 'password']);

/**
 * Security "none" sends the SMTP login and the messages in clear: allowed only for a relay on
 * this machine (`localhost`, `127.x.x.x`). Checked on the merged settings whenever the patch
 * touches the host or the security, so neither order of the two saves can end in that state;
 * the field named is the one the patch changed (`reason: 'tls-required'`).
 */
function checkEmailSecurity(draft: GlobalSettings, patch: SettingsPatchM5): void {
  const changes = patch.notify?.email;
  if (!changes || (changes.host === undefined && changes.security === undefined)) return;
  const { host, security } = draft.notify.email;
  if (security !== 'none' || !host || isLoopbackHostName(host)) return;
  const field = changes.security !== undefined ? 'security' : 'host';
  throw fieldError(`notify.email.${field}`, 'tls-required');
}

export function applyM5Patch(draft: GlobalSettings, patch: SettingsPatchM5): void {
  assignFields(draft.backup.schedule as unknown as Record<string, unknown>, patch.backup?.schedule);
  assignFields(draft.backup.github as unknown as Record<string, unknown>, patch.backup?.github);
  assignFields(draft.notify.telegram as unknown as Record<string, unknown>, patch.notify?.telegram);
  assignFields(draft.notify.email as unknown as Record<string, unknown>, patch.notify?.email);
  checkEmailSecurity(draft, patch);
}
