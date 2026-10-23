/**
 * Server-side reminder scheduler (SPEC F17, G1): a per-vault plugin, so it runs while the
 * launcher keeps the server alive, with or without an app window. It evaluates at start (catch-up
 * after a shutdown), every 60 s, and right away after a wake (the wall clock jumped well beyond
 * the expected tick, or the date changed). Evaluations never overlap. The Telegram/email outbox
 * is drained after each evaluation but outside its queue, one drain at a time (a request during
 * a drain runs one more pass): a slow SMTP server never holds up the next check and its toasts.
 * Closing aborts a send in flight instead of waiting up to a minute for it.
 */
import { errorCodeOf } from '../app-context/app-context-errors.js';
import {
  REMINDERS_PLUGIN,
  type VaultPlugin,
  type VaultPluginHost,
} from '../app-context/vault-plugins.js';
import type { AtomicWriteHooks } from '../fs/atomic-write-file.js';
import { toLocalDate } from '../lib/local-date.js';
import type { ChannelDeps } from './channels/channel-types.js';
import { startNotifyOutbox, type NotifyStatusSource } from './notify-outbox-service.js';
import { stillDueMatcher } from './notify-outbox-relevance.js';
import { evaluateReminders } from './reminder-evaluation.js';
import { listReminders, remindableItems } from './reminder-items.js';
import { openReminderStore } from './reminder-store.js';
import { reminderTimeOf } from './reminder-time.js';
import type { ReminderEntry, ReminderService } from './reminder-types.js';
import { createWindowsToastDeliverer, type ToastDeliverer } from './windows-toast.js';

export const TICK_MS = 60_000;
/** A tick this much later than expected means the machine slept (or the clock was changed). */
export const WAKE_SLACK_MS = 90_000;

/** Interval timers, injectable so tests drive ticks by hand with a mocked clock. */
export interface ReminderTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface RemindersPluginOptions {
  /** Wall clock; defaults to the context's clock (the one the deadline service uses). */
  now?: () => Date;
  timers?: ReminderTimers;
  /** Toast delivery; defaults to the Windows toast (PowerShell, then node-notifier). */
  deliver?: ToastDeliverer;
  /** Platform for the default deliverer (`win32` shows toasts, others are `unsupported`). */
  platform?: NodeJS.Platform;
  /** Test-only faults for writes of `reminders.json`. */
  storeHooks?: AtomicWriteHooks;
  /** M5 (F31): network of the Telegram/email channels (tests inject fetch and the SMTP transport). */
  notify?: ChannelDeps;
}

const nodeTimers: ReminderTimers = {
  setInterval(callback, ms) {
    const handle = setInterval(callback, ms);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

async function startReminders(
  host: VaultPluginHost,
  options: RemindersPluginOptions,
): Promise<ReminderService & NotifyStatusSource> {
  const { context, logger } = host;
  const now = options.now ?? context.now;
  const store = await openReminderStore({
    stateDir: context.vault.paths.stateDir,
    now,
    logger,
    hooks: options.storeHooks,
  });
  const deliverer =
    options.deliver ?? createWindowsToastDeliverer({ logger, platform: options.platform });
  let closed = false;
  let queue: Promise<ReminderEntry[]> = Promise.resolve([]);
  const closing = new AbortController();
  const outbox = await startNotifyOutbox({
    stateDir: context.vault.paths.stateDir,
    settings: host.settings,
    port: host.port,
    now,
    logger,
    isOpen: () => !closed,
    channels: options.notify,
    // F17 for every retry: a done, rescheduled or deleted item is never sent.
    async stillDue() {
      await context.settled();
      return stillDueMatcher(remindableItems(context));
    },
  });
  const deps = {
    context,
    store,
    deliverer,
    settings: host.settings,
    port: host.port,
    logger,
    now,
    isOpen: () => !closed,
    onFired: (entries: readonly ReminderEntry[]) => outbox.onFired(entries),
  };

  // F31.2: what fired now and the retries that are due (never throws), single-flight.
  let draining: Promise<void> | null = null;
  let drainAgain = false;
  const requestDrain = (): Promise<void> => {
    drainAgain = true;
    draining ??= (async () => {
      try {
        while (drainAgain && !closed) {
          drainAgain = false;
          await outbox.drain(closing.signal);
        }
      } finally {
        draining = null;
      }
    })();
    return draining;
  };

  /** One evaluation in the queue, then a drain outside it; resolves after both. */
  const enqueue = async (): Promise<ReminderEntry[]> => {
    const evaluation = queue.then(async () => {
      if (closed) return [];
      try {
        return await evaluateReminders(deps);
      } catch (error) {
        logger.warn(`Reminder check failed (${errorCodeOf(error)}); retrying on the next tick.`);
        return [];
      }
    });
    queue = evaluation;
    const fired = await evaluation;
    if (!closed) await requestDrain();
    return fired;
  };

  const timers = options.timers ?? nodeTimers;
  let lastTick = now();
  const handle = timers.setInterval(() => {
    const current = now();
    const late = current.getTime() - lastTick.getTime() > TICK_MS + WAKE_SLACK_MS;
    if (late || toLocalDate(current) !== toLocalDate(lastTick))
      logger.info('Reminders: woke up or a new day began; checking now.');
    lastTick = current;
    void enqueue();
  }, TICK_MS);
  // Catch up whatever came due while the server was not running.
  void enqueue();

  return {
    list: () => listReminders(store.entries(), remindableItems(context), now()),
    async dismiss(keys) {
      const wanted = new Set(keys);
      if (!store.entries().some((e) => wanted.has(e.key) && !e.dismissed)) return 0;
      let count = 0;
      await store.update((draft) => {
        count = 0;
        for (const entry of draft.entries) {
          if (!wanted.has(entry.key) || entry.dismissed) continue;
          entry.dismissed = true;
          count += 1;
        }
      });
      return count;
    },
    runNow: enqueue,
    time: () => reminderTimeOf(host.settings()),
    toastSupported: deliverer.supported,
    notifyStatus: () => outbox.status(),
    async close() {
      if (closed) return;
      closed = true;
      timers.clearInterval(handle);
      closing.abort(); // a Telegram/email send in flight stops now (counted as interrupted)
      await queue;
      await draining;
    },
  };
}

/** `context.attachPlugin(REMINDERS_PLUGIN, await plugin.start(host))` is done by the host. */
export function createRemindersPlugin(
  options: RemindersPluginOptions = {},
): VaultPlugin<ReminderService> {
  return { name: REMINDERS_PLUGIN, start: (host) => startReminders(host, options) };
}
