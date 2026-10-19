/**
 * The very first index of a vault reconstructs history it never observed: one approximate
 * `note_created` per note, dated from the `created` front matter (else the file's mtime), so the
 * graph time scrubber has a starting point (SPEC §4.15).
 */
import { isCalendarDate, localMidnight } from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { IndexEvent } from './event-log.js';
import { isLoggedNote } from './index-events.js';

export interface HistorySource {
  path: VaultPath;
  created: string | null;
  mtimeMs: number;
}

/** A `created` value as an instant: a date means local midnight; a date-time is taken as is. */
function createdInstant(created: string | null): Date | null {
  if (!created) return null;
  const value = created.trim();
  const day = value.slice(0, 10);
  if (!isCalendarDate(day)) return null;
  if (value.length > 10) {
    const instant = new Date(value);
    if (!Number.isNaN(instant.getTime())) return instant;
  }
  return localMidnight(day);
}

export function approximateHistory(notes: readonly HistorySource[]): IndexEvent[] {
  return notes
    .filter((n) => isLoggedNote(n.path))
    .map((n) => ({ n, at: createdInstant(n.created) ?? new Date(n.mtimeMs) }))
    .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.n.path < b.n.path ? -1 : 1))
    .map(({ n, at }) => ({
      ts: at.toISOString(),
      event: 'note_created',
      path: n.path,
      approx: true,
    }));
}
