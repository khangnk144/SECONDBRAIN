/**
 * Durable event log `state/events.jsonl` (SPEC §4.15): append-only, one JSON object per line,
 * the source of the graph time scrubber. Only paths and link targets are written, never note
 * content. A failed append is reported and swallowed: the index itself is still correct.
 */
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { VaultPath } from '../vault/vault-types.js';

export type IndexEventName =
  'note_created' | 'note_deleted' | 'note_renamed' | 'link_added' | 'link_removed';

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

export function createEventLog(file: string, onError: (error: unknown) => void): EventLog {
  const write = (text: string) => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      appendFileSync(file, text, 'utf8');
    } catch (error) {
      onError(error);
    }
  };
  return {
    file,
    exists: () => existsSync(file),
    append(events) {
      if (events.length === 0) return;
      write(events.map((e) => `${JSON.stringify(e)}\n`).join(''));
    },
    touch() {
      if (!existsSync(file)) write('');
    },
  };
}
