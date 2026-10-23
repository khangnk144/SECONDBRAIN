/**
 * Outbox of Telegram/email reminders `<vault>/.secondbrain/state/notify-outbox.json` (SPEC F31.2,
 * §4.13 durable state). One entry per `vaultId|itemId|due|threshold|channel`, written before
 * anything is sent. Like `reminders.json`: atomic writes, the memory copy changes only after a
 * write succeeded, a garbled file is kept as `.corrupt-<ts>`, and a file that exists but cannot
 * be read right now is never replaced (writes are refused until it can be read). No secret is
 * ever stored here: titles, paths and dates only.
 */
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import { atomicWriteFile, type AtomicWriteHooks } from '../fs/atomic-write-file.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import {
  NOTIFY_CHANNELS,
  type ChannelError,
  type NotifyChannelName,
} from './channels/channel-types.js';
import type { ReminderThreshold } from './reminder-types.js';

export const NOTIFY_OUTBOX_FILE = 'notify-outbox.json';
/** Finished entries (sent, failed, dropped) older than this are dropped on the next write. */
export const OUTBOX_RETENTION_DAYS = 60;
const DAY_MS = 86_400_000;

/** `sending`: claimed for one attempt; found at start → the send may have happened: `failed`. */
export type OutboxStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'dropped';

export interface OutboxEntry {
  key: string;
  /** The reminder's key in `reminders.json` (`vaultId|itemId|due|threshold`). */
  reminderKey: string;
  channel: NotifyChannelName;
  path: string;
  title: string;
  due: string;
  threshold: ReminderThreshold;
  createdAt: string;
  status: OutboxStatus;
  attempts: number;
  /** When the next attempt may run (pending only). */
  nextAttemptAt: string | null;
  sentAt?: string;
  /** `not-relevant`: dropped because the item was done, rescheduled or deleted meanwhile. */
  lastError?: ChannelError | 'channel-off' | 'not-relevant';
}

export interface NotifyOutbox {
  readonly file: string;
  entries(): readonly OutboxEntry[];
  has(key: string): boolean;
  /** Applies `change` to a copy, prunes, writes atomically, then adopts it. Calls are queued. */
  update(change: (entries: OutboxEntry[]) => void): Promise<void>;
}

const FINISHED = new Set<OutboxStatus>(['sent', 'failed', 'dropped']);
const STATUSES = new Set<OutboxStatus>(['pending', 'sending', 'sent', 'failed', 'dropped']);

function isEntry(value: unknown): value is OutboxEntry {
  const e = value as Partial<OutboxEntry> | null;
  return (
    !!e &&
    typeof e.key === 'string' &&
    typeof e.reminderKey === 'string' &&
    NOTIFY_CHANNELS.includes(e.channel as NotifyChannelName) &&
    typeof e.path === 'string' &&
    typeof e.title === 'string' &&
    typeof e.due === 'string' &&
    [0, 1, 3].includes(e.threshold as number) &&
    typeof e.createdAt === 'string' &&
    STATUSES.has(e.status as OutboxStatus) &&
    Number.isInteger(e.attempts)
  );
}

/** The entries of a file, or null when it is not an outbox at all. */
export function parseOutbox(text: string): OutboxEntry[] | null {
  try {
    const data = JSON.parse(text) as { entries?: unknown };
    return Array.isArray(data.entries) ? data.entries.filter(isEntry) : null;
  } catch {
    return null;
  }
}

function prune(entries: OutboxEntry[], now: Date): OutboxEntry[] {
  const cutoff = now.getTime() - OUTBOX_RETENTION_DAYS * DAY_MS;
  return entries.filter((e) => !FINISHED.has(e.status) || Date.parse(e.createdAt) >= cutoff);
}

const serialize = (entries: OutboxEntry[]) =>
  `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;

export async function openNotifyOutbox(options: {
  stateDir: string;
  now: () => Date;
  logger: AppLogger;
  hooks?: AtomicWriteHooks;
}): Promise<NotifyOutbox> {
  const file = path.join(options.stateDir, NOTIFY_OUTBOX_FILE);
  let entries: OutboxEntry[] = [];
  let keys = new Set<string>();
  let loaded = false;

  async function load(): Promise<boolean> {
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return (loaded = true);
      options.logger.warn(`Reminder outbox could not be read (${errorCodeOf(error)}).`);
      return false;
    }
    let parsed = parseOutbox(text);
    if (parsed === null) {
      const stamp = options.now().toISOString().replace(/[:.]/g, '-');
      try {
        await copyFile(file, `${file}.corrupt-${stamp}`);
      } catch (error) {
        options.logger.warn(
          `Reminder outbox is unreadable and could not be kept (${errorCodeOf(error)}).`,
        );
        return false;
      }
      options.logger.warn('Reminder outbox was unreadable; a copy was kept and it starts empty.');
      parsed = [];
    }
    // At most once: a send that was under way when the server stopped is not repeated.
    let interrupted = 0;
    for (const entry of parsed) {
      if (entry.status !== 'sending') continue;
      entry.status = 'failed';
      entry.lastError = 'interrupted';
      entry.nextAttemptAt = null;
      interrupted += 1;
    }
    if (interrupted > 0)
      options.logger.warn(`Reminder outbox: ${interrupted} interrupted sends are not repeated.`);
    entries = parsed;
    keys = new Set(entries.map((e) => e.key));
    return (loaded = true);
  }

  await load();
  let queue: Promise<unknown> = Promise.resolve();
  return {
    file,
    entries: () => entries,
    has: (key) => keys.has(key),
    update(change) {
      const run = queue.then(async () => {
        if (!loaded && !(await load())) throw new Error('The reminder outbox cannot be read.');
        const draft = structuredClone(entries);
        change(draft);
        const next = prune(draft, options.now());
        await atomicWriteFile(file, serialize(next), { hooks: options.hooks });
        entries = next;
        keys = new Set(entries.map((e) => e.key));
      });
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
