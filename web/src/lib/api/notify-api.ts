/**
 * Telegram/email reminders (SPEC F31), mirrored from `server/src/api/notify-routes.ts`. A failed
 * send answers `{ ok: false, error }` with a code only.
 */
import { api } from '../api';

export type NotifyChannelName = 'telegram' | 'email';

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
  | 'busy'
  | 'failed'
  | 'interrupted'
  /** Security "none" with a server that is not on this machine. */
  | 'tls-required';

export type ChannelResult = { ok: true } | { ok: false; error: ChannelError };

export interface ChannelStatus {
  pending: number;
  lastSentAt: string | null;
  lastError: ChannelError | null;
}

export type NotifyStatus =
  ({ available: true } & Record<NotifyChannelName, ChannelStatus>) | { available: false };

/** "Gửi thử": one test message now with the saved settings. */
export const sendTestMessage = (channel: NotifyChannelName) =>
  api().request<ChannelResult>('/notify/test', { method: 'POST', body: { channel } });

export const getNotifyStatus = () => api().get<NotifyStatus>('/notify/status');
