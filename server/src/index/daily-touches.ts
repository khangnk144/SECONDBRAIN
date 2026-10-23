/**
 * "Was this note already touched today?" for the event log, so `note_edited` is written at most
 * once per note per local day (50 saves → one line). A `note_created` of the same day counts as
 * touched, a rename carries the mark to the new path. The set holds one day; when an event of
 * another day arrives it is rebuilt from that day's lines at the end of the log (only the tail
 * is read, so start-up stays fast even with a log of many MB).
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { toLocalDate } from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { IndexEvent } from './event-log.js';

/** How much of the end of `events.jsonl` is read to seed the set (one day fits easily). */
export const DEFAULT_TAIL_BYTES = 256 * 1024;

/** The local calendar day of an event, or null for an unreadable timestamp. */
export function eventDay(event: Pick<IndexEvent, 'ts'>): string | null {
  const instant = new Date(event.ts);
  return Number.isNaN(instant.getTime()) ? null : toLocalDate(instant);
}

/** The last `bytes` of a file as text, without the first (probably cut) line; '' when missing. */
export function readTail(file: string, bytes: number): string {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return '';
  }
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    let read = 0;
    while (read < buffer.length) {
      const n = readSync(fd, buffer, read, buffer.length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const text = buffer.subarray(0, read).toString('utf8');
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } finally {
    closeSync(fd);
  }
}

/** Parses JSONL text; unreadable lines are skipped (a crash may have cut the last one). */
export function parseEventLines(text: string): IndexEvent[] {
  const out: IndexEvent[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const value = JSON.parse(line) as IndexEvent;
      if (value && typeof value.event === 'string' && typeof value.path === 'string')
        out.push(value);
    } catch {
      // skipped on purpose
    }
  }
  return out;
}

export interface DailyTouches {
  /** False for a `note_edited` of a note already touched that day; records the event. */
  accept(event: IndexEvent): boolean;
  /** Forget everything (the next event re-reads the tail), e.g. after a failed append. */
  reset(): void;
}

export function createDailyTouches(file: string, tailBytes = DEFAULT_TAIL_BYTES): DailyTouches {
  let day: string | null = null;
  let touched = new Set<VaultPath>();

  const record = (event: IndexEvent) => {
    if (event.event === 'note_created' || event.event === 'note_edited') touched.add(event.path);
    else if (event.event === 'note_renamed' && event.oldPath && touched.has(event.oldPath))
      touched.add(event.path);
    else if (event.event === 'note_deleted') touched.delete(event.path);
  };

  const seed = (wanted: string) => {
    day = wanted;
    touched = new Set();
    for (const event of parseEventLines(readTail(file, tailBytes)))
      if (!event.approx && eventDay(event) === wanted) record(event);
  };

  return {
    accept(event) {
      // Reconstructed history (first index) is dated in the past: it never moves the day.
      if (event.approx) return true;
      const current = eventDay(event);
      if (current === null) return true;
      if (current !== day) seed(current);
      if (event.event === 'note_edited' && touched.has(event.path)) return false;
      record(event);
      return true;
    },
    reset() {
      day = null;
      touched = new Set();
    },
  };
}
