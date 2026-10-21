/**
 * Dedupe store `<vault>/.secondbrain/state/reminders.json` (SPEC F17, §4.13: durable state, in
 * backups). Every change is written atomically before anyone acts on it, and the in-memory copy
 * changes only after the write succeeded, so a failed write never leads to a toast that would be
 * repeated after a restart. Unreadable or unknown files are kept as `.corrupt-<ts>` copies. A file
 * that exists but cannot be read right now (locked by a sync client or antivirus, permissions) is
 * never replaced: the store refuses writes and retries the read until it works.
 */
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import { atomicWriteFile, type AtomicWriteHooks } from '../fs/atomic-write-file.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import {
  parseReminderStore,
  taskTwinKey,
  type ReminderStoreData,
} from './reminder-store-format.js';
import type { ReminderEntry, ReminderThreshold } from './reminder-types.js';

export const REMINDERS_FILE = 'reminders.json';
/** Entries (and superseded keys) older than this are dropped on the next write. */
export const REMINDER_RETENTION_DAYS = 60;
const DAY_MS = 86_400_000;

export interface ReminderStore {
  readonly file: string;
  /**
   * True once the file was read (or found missing). While false the store knows nothing, so a
   * caller must not decide what to remind from it; `update` rejects with the read error's code.
   */
  readonly loaded: boolean;
  /** Retries a failed read (queued with the updates); true when the store can be used. */
  ensureLoaded(): Promise<boolean>;
  entries(): readonly ReminderEntry[];
  /** The key fired or was superseded. */
  has(key: string): boolean;
  /** A fired task reminder of the same note, text, due date and threshold (its line moved). */
  hasTaskTwin(path: string, title: string, due: string, threshold: ReminderThreshold): boolean;
  /** Applies `change` to a copy, prunes, writes atomically, then adopts it. Calls are queued. */
  update(change: (draft: ReminderStoreData) => void): Promise<void>;
}

export interface ReminderStoreOptions {
  stateDir: string;
  now: () => Date;
  logger: AppLogger;
  /** Test-only write faults. */
  hooks?: AtomicWriteHooks;
}

const emptyStore = (): ReminderStoreData => ({ version: 1, entries: [], superseded: [] });

function prune(data: ReminderStoreData, now: Date): ReminderStoreData {
  const cutoff = now.getTime() - REMINDER_RETENTION_DAYS * DAY_MS;
  const fresh = (iso: string) => Date.parse(iso) >= cutoff;
  return {
    version: 1,
    entries: data.entries.filter((e) => fresh(e.firedAt)),
    superseded: data.superseded.filter((s) => fresh(s.recordedAt)),
  };
}

/** Rejected writes while the file cannot be read; `code` is the read error's (for logs). */
export class ReminderStoreUnreadableError extends Error {
  constructor(readonly code: string) {
    super(`Reminder state cannot be read right now (${code}).`);
    this.name = 'ReminderStoreUnreadableError';
  }
}

/** The stored data, or the code of a read error other than "no file yet". */
async function loadFile(
  options: ReminderStoreOptions,
  file: string,
): Promise<{ data: ReminderStoreData } | { unreadable: string }> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { data: emptyStore() };
    return { unreadable: errorCodeOf(error) };
  }
  const parsed = parseReminderStore(text);
  if (parsed) {
    if (parsed.dropped > 0)
      options.logger.warn(`Reminder state: ${parsed.dropped} malformed entries ignored.`);
    return { data: parsed.data };
  }
  const stamp = options.now().toISOString().replace(/[:.]/g, '-');
  try {
    await copyFile(file, `${file}.corrupt-${stamp}`);
  } catch (error) {
    // Without a copy the file must not be replaced later: treated like one that cannot be read.
    return { unreadable: errorCodeOf(error) };
  }
  try {
    await atomicWriteFile(file, serialize(emptyStore()), { hooks: options.hooks });
    options.logger.warn('Reminder state was unreadable; a copy was kept and it starts empty.');
  } catch (error) {
    options.logger.warn(
      `Reminder state was unreadable; a copy was kept but it could not be reset (${errorCodeOf(error)}).`,
    );
  }
  return { data: emptyStore() };
}

const serialize = (data: ReminderStoreData) => `${JSON.stringify(data, null, 2)}\n`;

export async function openReminderStore(options: ReminderStoreOptions): Promise<ReminderStore> {
  const file = path.join(options.stateDir, REMINDERS_FILE);
  let data = emptyStore();
  let loaded = false;
  let readError: string | null = null;
  let keys = new Set<string>();
  let twins = new Set<string>();
  const reindex = () => {
    keys = new Set([...data.entries.map((e) => e.key), ...data.superseded.map((s) => s.key)]);
    twins = new Set(
      data.entries
        .filter((e) => e.itemId.startsWith('task:'))
        .map((e) => taskTwinKey(e.path, e.title, e.due, e.threshold)),
    );
  };
  /** One read attempt; a failure is logged once per error code, not on every retry. */
  async function load(): Promise<boolean> {
    const result = await loadFile(options, file);
    if ('unreadable' in result) {
      if (result.unreadable !== readError)
        options.logger.warn(
          `Reminder state could not be read (${result.unreadable}); no reminder is recorded or shown until it can be.`,
        );
      readError = result.unreadable;
      return false;
    }
    if (readError !== null) options.logger.info('Reminder state can be read again.');
    readError = null;
    data = prune(result.data, options.now());
    loaded = true;
    reindex();
    return true;
  }

  await load();
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    file,
    get loaded() {
      return loaded;
    },
    ensureLoaded: () => enqueue(async () => loaded || load()),
    entries: () => data.entries,
    has: (key) => keys.has(key),
    hasTaskTwin: (p, title, due, threshold) => twins.has(taskTwinKey(p, title, due, threshold)),
    update(change) {
      return enqueue(async () => {
        // Writing what little is known would replace the real file: refuse until it is read.
        if (!loaded && !(await load()))
          throw new ReminderStoreUnreadableError(readError ?? 'unknown');
        const draft = structuredClone(data);
        change(draft);
        const next = prune(draft, options.now());
        await atomicWriteFile(file, serialize(next), { hooks: options.hooks });
        data = next;
        reindex();
      });
    },
  };
}
