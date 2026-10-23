/**
 * Email channel (SPEC F31): one SMTP transport per message from the current settings –
 * `starttls` (port 587, upgrade required), `tls` (port 465, TLS from the start) or `none` (no
 * encryption, only for a relay on this machine: Settings refuses it for any other host, and a
 * setting saved before that rule is refused here with `tls-required`, so a password never crosses
 * the network in clear) – 15 s for connect, greeting and each command, plain text only.
 * nodemailer's logger stays off (it would log the AUTH exchange); errors become codes. Closing
 * the app aborts a send in flight (`interrupted`).
 */
import type { EmailSettings } from '../../config/settings-sections-m5.js';
import { isLoopbackHostName } from '../../lib/loopback-host.js';
import type {
  ChannelError,
  ChannelResult,
  NotifyChannel,
  SmtpTransport,
  SmtpTransportOptions,
} from './channel-types.js';

export const EMAIL_TIMEOUT_MS = 15_000;

const CONNECT_CODES = new Set([
  'ECONNECTION',
  'ESOCKET',
  'EDNS',
  'ETLS',
  'EREQUIRETLS',
  'EPROTOCOL',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
]);

export function emailError(error: unknown): ChannelError {
  const { code, responseCode } = (error ?? {}) as { code?: string; responseCode?: number };
  if (code === 'EAUTH' || code === 'ENOAUTH') return 'smtp-auth';
  if (code === 'ETIMEDOUT') return 'timeout';
  if (code && CONNECT_CODES.has(code)) return 'smtp-connect';
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return 'rejected';
  if (typeof responseCode === 'number' && responseCode >= 500) return 'rejected';
  return 'failed';
}

/** What the transport gets from the settings (the password only here, never logged). */
export function smtpOptions(email: EmailSettings, timeoutMs: number): SmtpTransportOptions {
  return {
    host: email.host ?? '',
    port: email.port,
    secure: email.security === 'tls',
    requireTLS: email.security === 'starttls',
    ignoreTLS: email.security === 'none',
    ...(email.user ? { auth: { user: email.user, pass: email.password ?? '' } } : {}),
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

/** nodemailer loads only when a message is really sent (never while both channels are off). */
export async function nodemailerTransport(options: SmtpTransportOptions): Promise<SmtpTransport> {
  const { createTransport } = await import('nodemailer');
  return createTransport(options) as unknown as SmtpTransport;
}

export interface EmailOptions {
  email: EmailSettings;
  createTransport?: (options: SmtpTransportOptions) => SmtpTransport | Promise<SmtpTransport>;
  timeoutMs?: number;
}

export function createEmailChannel(options: EmailOptions): NotifyChannel {
  const timeoutMs = options.timeoutMs ?? EMAIL_TIMEOUT_MS;
  const make = options.createTransport ?? nodemailerTransport;
  return {
    name: 'email',
    async send(message, signal): Promise<ChannelResult> {
      const { email } = options;
      if (!email.host || !email.from || !email.to) return { ok: false, error: 'not-configured' };
      if (email.security === 'none' && !isLoopbackHostName(email.host))
        return { ok: false, error: 'tls-required' };
      if (signal?.aborted) return { ok: false, error: 'interrupted' };
      let transport: SmtpTransport | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let stop: (() => void) | undefined;
      try {
        transport = await make(smtpOptions(email, timeoutMs));
        // An overall cap as well: a server that trickles its answers never holds a reminder.
        const overall = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })),
            timeoutMs * 3,
          );
          stop = () => reject(Object.assign(new Error('aborted'), { code: 'EABORTED' }));
          signal?.addEventListener('abort', stop, { once: true });
        });
        await Promise.race([
          transport.sendMail({
            from: email.from,
            to: email.to,
            subject: message.subject,
            text: message.text,
          }),
          overall,
        ]);
        return { ok: true };
      } catch (error) {
        if (signal?.aborted) return { ok: false, error: 'interrupted' };
        return { ok: false, error: emailError(error) };
      } finally {
        clearTimeout(timer);
        if (stop) signal?.removeEventListener('abort', stop);
        try {
          transport?.close();
        } catch {
          // Closing a transport that never connected can throw; nothing to undo.
        }
      }
    },
  };
}
