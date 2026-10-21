/**
 * Reminder plugin on a real vault test app: manual interval timers (a test "ticks" after moving
 * the mocked clock), a recording toast deliverer and helpers to rewrite notes through the vault
 * service. No real PowerShell or notifier ever runs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { REMINDERS_PLUGIN } from '../../../src/app-context/vault-plugins.js';
import type { AppLogger } from '../../../src/logging/rotating-file-logger.js';
import type { ToastContent } from '../../../src/reminders/reminder-messages.js';
import type { ReminderStoreData } from '../../../src/reminders/reminder-store-format.js';
import type { ReminderService, ToastOutcome } from '../../../src/reminders/reminder-types.js';
import {
  createRemindersPlugin,
  type ReminderTimers,
  type RemindersPluginOptions,
} from '../../../src/reminders/reminders-plugin.js';
import type { ToastDeliverer } from '../../../src/reminders/windows-toast.js';
import type { ServerEvent } from '../../../src/ws/server-events.js';
import { createMemoryLogger, type VaultTestApp } from '../../api/vault-test-app.js';

export interface ManualTimers extends ReminderTimers {
  /** Runs every registered interval callback once (as if 60 s passed). */
  tick(): void;
  readonly active: number;
}

export function manualTimers(): ManualTimers {
  const callbacks = new Map<number, () => void>();
  let next = 1;
  return {
    setInterval(callback) {
      callbacks.set(next, callback);
      return next++;
    },
    clearInterval(handle) {
      callbacks.delete(handle as number);
    },
    tick() {
      for (const callback of [...callbacks.values()]) callback();
    },
    get active() {
      return callbacks.size;
    },
  };
}

export interface RecordingDeliverer extends ToastDeliverer {
  toasts: ToastContent[];
  outcome: ToastOutcome;
}

export function recordingDeliverer(supported = true): RecordingDeliverer {
  const deliverer: RecordingDeliverer = {
    supported,
    toasts: [],
    outcome: supported ? 'shown' : 'unsupported',
    async deliver(toast) {
      deliverer.toasts.push(toast);
      return deliverer.outcome;
    },
  };
  return deliverer;
}

export interface StartedReminders {
  service: ReminderService;
  timers: ManualTimers;
  deliverer: RecordingDeliverer;
  logger: AppLogger & { lines: string[] };
}

/** Starts the plugin the way the vault host does and attaches it to the context. */
export async function startReminders(
  t: VaultTestApp,
  options: RemindersPluginOptions & { deliverer?: RecordingDeliverer } = {},
): Promise<StartedReminders> {
  const timers = manualTimers();
  const deliverer = options.deliverer ?? recordingDeliverer();
  const logger = createMemoryLogger();
  const service = await createRemindersPlugin({ timers, deliver: deliverer, ...options }).start({
    context: t.context,
    settings: () => t.settings,
    port: t.port,
    logger,
  });
  t.context.attachPlugin(REMINDERS_PLUGIN, service);
  return { service, timers, deliverer, logger };
}

/** Collects every WebSocket event the context broadcasts. */
export function captureEvents(t: VaultTestApp): ServerEvent[] {
  const events: ServerEvent[] = [];
  t.context.hub.add({
    readyState: 1,
    bufferedAmount: 0,
    send: (data) => events.push(JSON.parse(data) as ServerEvent),
    terminate: () => undefined,
    on: () => undefined,
  });
  return events;
}

export function storeFile(t: VaultTestApp): string {
  return path.join(t.context.vault.paths.stateDir, 'reminders.json');
}

export function readStore(t: VaultTestApp): ReminderStoreData {
  return JSON.parse(readFileSync(storeFile(t), 'utf8')) as ReminderStoreData;
}

/** Rewrites a note through the vault service (revision-checked) and waits for the index. */
export async function rewriteNote(
  t: VaultTestApp,
  vaultPath: string,
  edit: (content: string) => string,
): Promise<void> {
  const current = await t.context.vault.read(vaultPath);
  await t.context.vault.write(vaultPath, edit(current.content), current.revision);
  await t.context.settled();
}

export async function createNote(t: VaultTestApp, vaultPath: string, content: string) {
  await t.context.vault.create(vaultPath, content);
  await t.context.settled();
}

export const projectNote = (deadline: string, status = 'doing') =>
  `---\ntype: project\nstatus: ${status}\ndeadline: ${deadline}\n---\n# Ghi chú\n`;

/** Local time; months are 1-based here (unlike `new Date`). */
export const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi);
