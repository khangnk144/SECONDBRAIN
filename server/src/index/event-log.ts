/**
 * Durable event log `state/events.jsonl` (SPEC §4.15): append-only, one JSON object per line,
 * the source of the graph time scrubber and of the Today activity counts (M5). Only paths and
 * link targets are written, never note content. A failed append is reported and swallowed: the
 * index itself is still correct. A process that died mid-append leaves a last line without its
 * newline; the first append of a process (and the first after a failed one) therefore checks the
 * file's last byte and starts on a new line, so the cut fragment stays one unreadable line on its
 * own instead of swallowing the next event (review L1).
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
} from 'node:fs';
import path from 'node:path';
import type { VaultPath } from '../vault/vault-types.js';
import { createDailyTouches, DEFAULT_TAIL_BYTES } from './daily-touches.js';

/**
 * `note_edited` (M5, path only): the content of a note the index already held changed. Written
 * at most once per note per local day; readers that do not know it (graph history) skip it.
 */
export type IndexEventName =
  'note_created' | 'note_deleted' | 'note_renamed' | 'note_edited' | 'link_added' | 'link_removed';

export interface IndexEvent {
  /** ISO 8601 instant. */
  ts: string;
  event: IndexEventName;
  /** The note (for link events: the linking note). */
  path: VaultPath;
  /** Link events: the resolved target path, or the raw target text of an unresolved link. */
  target?: string;
  /** note_renamed: the previous path. */
  oldPath?: VaultPath;
  /** Reconstructed history written by the very first index of a vault. */
  approx?: true;
}

export interface EventLog {
  readonly file: string;
  exists(): boolean;
  append(events: readonly IndexEvent[]): void;
  /** Creates an empty log when missing: the vault now counts as indexed at least once. */
  touch(): void;
}

export interface EventLogOptions {
  /** Bytes of the log's end read to know which notes were already touched today (tests). */
  tailBytes?: number;
}

/** True when the file exists, is not empty and does not end with a newline. */
function endsMidLine(file: string): boolean {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return false; // missing: the append creates it
  }
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return false;
    const last = Buffer.alloc(1);
    readSync(fd, last, 0, 1, size - 1);
    return last[0] !== 0x0a;
  } finally {
    closeSync(fd);
  }
}

export function createEventLog(
  file: string,
  onError: (error: unknown) => void,
  options: EventLogOptions = {},
): EventLog {
  const touches = createDailyTouches(file, options.tailBytes ?? DEFAULT_TAIL_BYTES);
  /** The file is known to end with a newline (checked, then only whole lines appended). */
  let tailChecked = false;
  const write = (text: string): boolean => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const prefix = !tailChecked && text !== '' && endsMidLine(file) ? '\n' : '';
      appendFileSync(file, prefix + text, 'utf8');
      if (text !== '') tailChecked = true;
      return true;
    } catch (error) {
      tailChecked = false; // a part may have been written: look again before the next one
      onError(error);
      return false;
    }
  };
  return {
    file,
    exists: () => existsSync(file),
    append(events) {
      const kept = events.filter((event) => touches.accept(event));
      if (kept.length === 0) return;
      // Not written: what was marked as touched may not be in the file, so read it again later.
      if (!write(kept.map((e) => `${JSON.stringify(e)}\n`).join(''))) touches.reset();
    },
    touch() {
      if (!existsSync(file)) write('');
    },
  };
}
