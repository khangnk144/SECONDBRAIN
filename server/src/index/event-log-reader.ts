/**
 * Reads `state/events.jsonl` for the views built on it. One reader per open vault, held by its
 * activity service (`context.activity.events()`): Today, the weekly review, the brain map's
 * creation times and its history all share its cache. The log is append-only and can grow to
 * many MB, so the parsed events are cached by size and mtime: an unchanged file is not read
 * again, a grown one is read only from where the last read ended, and a rewritten one
 * (compaction, a restore) – detected by its first bytes – is read anew. A last line without its
 * newline (being written right now) waits for the next read.
 */
import { createReadStream } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import { parseEventLines } from './daily-touches.js';
import type { IndexEvent } from './event-log.js';

const HEAD_BYTES = 512;
const NEWLINE = 0x0a;

export interface EventLogReader {
  /** Every readable event in file order (oldest written first); the array is shared, read-only. */
  read(): Promise<readonly IndexEvent[]>;
}

interface Cache {
  size: number;
  mtimeMs: number;
  /** Bytes consumed (up to the last complete line). */
  offset: number;
  head: string;
  events: IndexEvent[];
}

async function readHead(file: string, bytes: number): Promise<string> {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('latin1');
  } finally {
    await handle.close();
  }
}

/** Parses complete lines of `[start, end)`; returns them and the bytes consumed. */
async function readLines(
  file: string,
  start: number,
  end: number,
): Promise<{ events: IndexEvent[]; consumed: number }> {
  const events: IndexEvent[] = [];
  if (end <= start) return { events, consumed: 0 };
  let pending: Buffer[] = [];
  let consumed = 0;
  // Lines are cut on bytes, then decoded whole: a chunk edge never splits a UTF-8 character.
  for await (const chunk of createReadStream(file, {
    start,
    end: end - 1,
  }) as AsyncIterable<Buffer>) {
    let from = 0;
    let at = chunk.indexOf(NEWLINE, from);
    while (at !== -1) {
      const line = Buffer.concat([...pending, chunk.subarray(from, at)]);
      pending = [];
      consumed += line.length + 1;
      events.push(...parseEventLines(line.toString('utf8')));
      from = at + 1;
      at = chunk.indexOf(NEWLINE, from);
    }
    if (from < chunk.length) pending.push(chunk.subarray(from));
  }
  return { events, consumed };
}

export function createEventLogReader(file: string): EventLogReader {
  let cache: Cache | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const refresh = async (): Promise<readonly IndexEvent[]> => {
    let info;
    try {
      info = await stat(file);
    } catch {
      cache = null; // no log yet (or unreadable): nothing happened as far as it knows
      return [];
    }
    if (cache && info.size === cache.size && info.mtimeMs === cache.mtimeMs) return cache.events;
    const head = await readHead(file, HEAD_BYTES);
    const sameFile =
      cache !== null &&
      info.size >= cache.offset &&
      head.startsWith(cache.head.slice(0, head.length));
    const base: Cache =
      sameFile && cache ? cache : { size: 0, mtimeMs: 0, offset: 0, head, events: [] };
    const { events, consumed } = await readLines(file, base.offset, info.size);
    for (const event of events) base.events.push(event); // no spread: may be 100k+ lines
    cache = {
      ...base,
      size: info.size,
      mtimeMs: info.mtimeMs,
      offset: base.offset + consumed,
      head,
    };
    return cache.events;
  };

  return {
    read() {
      // One read at a time: two incremental reads from the same offset would add lines twice.
      const run = queue.then(refresh);
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
