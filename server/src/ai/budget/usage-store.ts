/**
 * Monthly token usage in `<globalStateDir>/ai-usage.json` (SPEC F33 cost cap). Machine-wide, like
 * the API key and the bill: `{ version: 1, months: { 'YYYY-MM': { tokens, requests } } }` by local
 * calendar month. Writes are atomic and debounced (at most 1 s late), flushed on close; 13 months
 * are kept. A corrupt file is copied aside (`.corrupt-<ts>`) and counting starts again from zero.
 *
 * Requests in flight hold their estimate (`reserve`), so concurrent calls cannot together pass the
 * limit. One store is open per file: a request that outlives its vault (a stream still running
 * after a switch) records into the store open now, or straight into the file, never through the
 * closed store's old numbers.
 */
import { copyFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorCodeOf } from '../../app-context/app-context-errors.js';
import { atomicWriteFile } from '../../fs/atomic-write-file.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import type { ProviderTimers } from '../providers/provider-types.js';

export const USAGE_FILE_NAME = 'ai-usage.json';
export const USAGE_SAVE_DELAY_MS = 1000;
export const USAGE_MONTHS_KEPT = 13;

export interface MonthUsage {
  tokens: number;
  requests: number;
}

export interface UsageReservation {
  /** Replaces the held estimate with the real usage (0 = nothing recorded); once only. */
  settle(tokens: number, now: Date): void;
}

export interface UsageStore {
  /** Usage of the local calendar month of `now`. */
  month(now: Date): MonthUsage & { month: string };
  /** Tokens held by requests still in flight. */
  reserved(): number;
  /** Holds `estimate` tokens until the request settles. */
  reserve(estimate: number): UsageReservation;
  /** Adds one request's tokens to the month of `now` and schedules a save. */
  record(tokens: number, now: Date): void;
  /** Writes pending changes now. */
  flush(): Promise<void>;
  close(): Promise<void>;
}

export function monthKey(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

function parseUsage(text: string): Record<string, MonthUsage> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  const file = raw as { version?: unknown; months?: unknown } | null;
  if (!file || typeof file !== 'object' || file.version !== 1) return null;
  if (!file.months || typeof file.months !== 'object' || Array.isArray(file.months)) return null;
  const months: Record<string, MonthUsage> = {};
  for (const [key, value] of Object.entries(file.months as Record<string, unknown>)) {
    const entry = value as { tokens?: unknown; requests?: unknown } | null;
    const valid = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
    if (!MONTH_KEY.test(key) || !entry || !valid(entry.tokens) || !valid(entry.requests))
      return null;
    months[key] = { tokens: entry.tokens as number, requests: entry.requests as number };
  }
  return months;
}

/** The newest `USAGE_MONTHS_KEPT` months. */
function pruned(months: Record<string, MonthUsage>): Record<string, MonthUsage> {
  const keys = Object.keys(months).sort().slice(-USAGE_MONTHS_KEPT);
  return Object.fromEntries(keys.map((key) => [key, months[key]!]));
}

const usageText = (months: Record<string, MonthUsage>) =>
  `${JSON.stringify({ version: 1, months: pruned(months) }, null, 2)}\n`;

/** Adds one request to `months` (in place). */
function add(months: Record<string, MonthUsage>, tokens: number, now: Date): void {
  const key = monthKey(now);
  const usage = months[key] ?? { tokens: 0, requests: 0 };
  months[key] = {
    tokens: usage.tokens + Math.max(0, Math.round(tokens)),
    requests: usage.requests + 1,
  };
}

/** The store open for each usage file (at most one). */
const openStores = new Map<string, UsageStore>();
/** Late records written straight into a file no store has open, one after another. */
const lateWrites = new Map<string, Promise<void>>();

/** A record after the store closed and no other store is open: read, add, write once. */
function recordIntoFile(file: string, tokens: number, now: Date, logger: AppLogger): void {
  const write = async () => {
    let text: string | null = null;
    try {
      text = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const months = text === null ? {} : parseUsage(text);
    if (!months) throw Object.assign(new Error('unreadable'), { code: 'EBADUSAGE' });
    add(months, tokens, now);
    await atomicWriteFile(file, usageText(months));
  };
  const next = (lateWrites.get(file) ?? Promise.resolve()).then(write).catch((error: unknown) => {
    logger.warn(`Saving late AI usage failed (${errorCodeOf(error)}).`);
  });
  lateWrites.set(file, next);
}

export interface UsageStoreOptions {
  dir: string;
  timers: ProviderTimers;
  logger: AppLogger;
  now: () => Date;
}

export async function openUsageStore(options: UsageStoreOptions): Promise<UsageStore> {
  const { timers, logger } = options;
  const file = path.join(options.dir, USAGE_FILE_NAME);
  await openStores.get(file)?.close();
  await lateWrites.get(file);
  let months: Record<string, MonthUsage> = {};
  try {
    const parsed = parseUsage(await readFile(file, 'utf8'));
    if (parsed) {
      months = parsed;
    } else {
      const stamp = options.now().toISOString().replace(/[:.]/g, '-');
      await copyFile(file, `${file}.corrupt-${stamp}`);
      logger.warn('AI usage file was unreadable; kept a copy and started counting again.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      logger.warn(`AI usage file could not be read (${errorCodeOf(error)}); counting from zero.`);
  }

  let timer: unknown = null;
  let dirty = false;
  let closed = false;
  let held = 0;
  let writing: Promise<void> = Promise.resolve();

  const save = (): Promise<void> => {
    if (timer !== null) timers.clearTimeout(timer);
    timer = null;
    if (!dirty) return writing;
    dirty = false;
    months = pruned(months);
    const text = usageText(months);
    writing = writing
      .then(() => atomicWriteFile(file, text))
      .catch((error: unknown) => {
        dirty = true; // try again with the next change or on close
        logger.warn(`Saving AI usage failed (${errorCodeOf(error)}).`);
      });
    return writing;
  };
  /** After close, everything goes to the store open now for the same file (if any). */
  const successor = () => (closed ? openStores.get(file) : undefined);

  const store: UsageStore = {
    month(now) {
      const live = successor();
      if (live) return live.month(now);
      const key = monthKey(now);
      const usage = months[key] ?? { tokens: 0, requests: 0 };
      return { month: key, tokens: usage.tokens, requests: usage.requests };
    },
    reserved: () => successor()?.reserved() ?? held,
    reserve(estimate) {
      const live = successor();
      if (live) return live.reserve(estimate);
      const amount = Math.max(0, Math.ceil(estimate));
      held += amount;
      let open = true;
      return {
        settle(tokens, now) {
          if (!open) return;
          open = false;
          held -= amount;
          if (tokens > 0) store.record(tokens, now);
        },
      };
    },
    record(tokens, now) {
      if (closed) {
        const live = successor();
        if (live) live.record(tokens, now);
        else recordIntoFile(file, tokens, now, logger);
        return;
      }
      add(months, tokens, now);
      dirty = true;
      timer ??= timers.setTimeout(() => void save(), USAGE_SAVE_DELAY_MS);
    },
    flush: save,
    async close() {
      if (!closed) {
        closed = true;
        if (openStores.get(file) === store) openStores.delete(file);
      }
      await save();
    },
  };
  openStores.set(file, store);
  return store;
}
