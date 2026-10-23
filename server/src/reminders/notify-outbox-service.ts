/**
 * The Telegram/email part of the reminders plugin (SPEC F31): the outbox of the open vault, the
 * hook the scheduler calls when reminders fire, the drain after each pass, and the per-channel
 * status Settings shows. With both channels off nothing is enqueued and nothing is sent: no
 * network call, no transport, not even the outbox file.
 */
import type { GlobalSettings } from '../config/global-settings.js';
import { normalizeNotify } from '../config/settings-sections-m5.js';
import type { AtomicWriteHooks } from '../fs/atomic-write-file.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import {
  NOTIFY_CHANNELS,
  type ChannelDeps,
  type NotifyChannelName,
} from './channels/channel-types.js';
import { openNotifyOutbox, type OutboxEntry } from './notify-outbox.js';
import { activeChannels, drainOutbox, enqueueFired } from './notify-outbox-worker.js';
import { languageOf } from './reminder-messages.js';
import type { ReminderEntry } from './reminder-types.js';

export interface ChannelStatus {
  pending: number;
  lastSentAt: string | null;
  /** Code of the newest failure since the last success (or null). */
  lastError: string | null;
}

export type NotifyStatus = Record<NotifyChannelName, ChannelStatus>;

export interface NotifyOutboxService {
  onFired(entries: readonly ReminderEntry[]): Promise<number>;
  /** `signal`: aborted when the plugin closes (a send in flight stops). */
  drain(signal?: AbortSignal): Promise<number>;
  status(): NotifyStatus;
}

/** What `GET /api/notify/status` reads from the reminders plugin, when it has it. */
export interface NotifyStatusSource {
  notifyStatus?: () => NotifyStatus;
}

export async function startNotifyOutbox(options: {
  stateDir: string;
  settings: () => GlobalSettings;
  port: number;
  now: () => Date;
  logger: AppLogger;
  isOpen: () => boolean;
  channels?: ChannelDeps;
  hooks?: AtomicWriteHooks;
  /** Whether an entry's item still exists, open, with that due date (checked per drain). */
  stillDue?: () => Promise<(entry: OutboxEntry) => boolean>;
}): Promise<NotifyOutboxService> {
  const outbox = await openNotifyOutbox({
    stateDir: options.stateDir,
    now: options.now,
    logger: options.logger,
    hooks: options.hooks,
  });
  const notify = () => normalizeNotify(options.settings().notify);
  return {
    async onFired(entries) {
      const channels = activeChannels(notify());
      if (channels.length === 0 || entries.length === 0) return 0;
      return enqueueFired(outbox, entries, channels, options.now());
    },
    drain: (signal) =>
      drainOutbox({
        outbox,
        notify,
        language: () => languageOf(options.settings().ui?.language),
        port: options.port,
        now: options.now,
        logger: options.logger,
        channels: options.channels,
        isOpen: options.isOpen,
        stillDue: options.stillDue,
        signal,
      }),
    status() {
      const status = {} as NotifyStatus;
      for (const name of NOTIFY_CHANNELS) {
        const mine = outbox.entries().filter((e) => e.channel === name);
        const sent = mine.filter((e) => e.sentAt).map((e) => e.sentAt as string);
        const lastSentAt = sent.sort().at(-1) ?? null;
        // Dropped entries (channel off, item done or moved) are no failure of the channel.
        const failures = mine.filter(
          (e) => e.lastError && e.status !== 'dropped' && e.status !== 'sent',
        );
        const newestFailure = failures
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .at(-1);
        const failedAfterSuccess =
          newestFailure && (!lastSentAt || newestFailure.createdAt > lastSentAt);
        status[name] = {
          pending: mine.filter((e) => e.status === 'pending').length,
          lastSentAt,
          lastError: failedAfterSuccess ? (newestFailure.lastError ?? null) : null,
        };
      }
      return status;
    },
  };
}
