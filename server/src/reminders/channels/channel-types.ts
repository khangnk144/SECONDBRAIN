/**
 * Reminder channels outside the app (SPEC F31): Telegram and email behind one interface. A send
 * answers a short code on failure, never the service's own text (it can echo the token, the
 * chat id or the SMTP password) and never throws.
 */

export type NotifyChannelName = 'telegram' | 'email';
export const NOTIFY_CHANNELS: readonly NotifyChannelName[] = ['telegram', 'email'];

export interface ChannelMessage {
  /** Email subject (one line). */
  subject: string;
  /** Plain text body (Telegram sends only this). */
  text: string;
}

/** Why a message did not go out (`POST /api/notify/test` answers these). */
export type ChannelError =
  | 'auth'
  | 'chat-not-found'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'smtp-auth'
  | 'smtp-connect'
  | 'rejected'
  | 'not-configured'
  /** Security "none" with a server that is not on this machine (the password would go in clear). */
  | 'tls-required'
  /** The app closed during the send (it may have gone out). */
  | 'interrupted'
  | 'failed';

export type ChannelResult = { ok: true } | { ok: false; error: ChannelError };

export interface NotifyChannel {
  readonly name: NotifyChannelName;
  /** `signal`: aborted when the app closes; the send then stops and answers `interrupted`. */
  send(message: ChannelMessage, signal?: AbortSignal): Promise<ChannelResult>;
}

/** Network access of the channels, injectable so tests never reach the internet. */
export interface ChannelDeps {
  fetch?: typeof fetch;
  /** Builds the SMTP transport (default: nodemailer's `createTransport`). */
  createTransport?: (options: SmtpTransportOptions) => SmtpTransport | Promise<SmtpTransport>;
  /** For `SB_TELEGRAM_API_URL` (e2e mock server); default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  telegramTimeoutMs?: number;
  emailTimeoutMs?: number;
}

/** The part of nodemailer's SMTP options the email channel sets. */
export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  ignoreTLS: boolean;
  auth?: { user: string; pass: string };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  logger: false;
  debug: false;
  disableFileAccess: true;
  disableUrlAccess: true;
}

export interface SmtpTransport {
  sendMail(mail: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
  close(): void;
}
