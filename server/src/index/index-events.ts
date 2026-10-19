/**
 * Turns "what the index knew about a note before" and "what it knows now" into event-log lines.
 * A note's link identity is its resolved target path, or the raw target text when the link is
 * a ghost or ambiguous, so a ghost becoming resolved shows up as remove(text) + add(path).
 */
import type Database from 'better-sqlite3';
import type { VaultPath } from '../vault/vault-types.js';
import type { IndexEvent } from './event-log.js';

export interface NoteSnapshot {
  path: VaultPath;
  targets: ReadonlySet<string>;
}

/** Only Markdown notes are "notes" for the log (SPEC §4.1); other rows produce no events. */
export function isLoggedNote(path: VaultPath): boolean {
  return /\.md$/i.test(path);
}

export function takeSnapshot(db: Database.Database, path: VaultPath): NoteSnapshot | null {
  if (!isLoggedNote(path)) return null;
  const rows = db
    .prepare(
      `SELECT l.to_path AS toPath, l.target_raw AS raw, n.id AS id
       FROM notes n LEFT JOIN links l ON l.from_id = n.id WHERE n.path = ?`,
    )
    .all(path) as { toPath: string | null; raw: string | null; id: number }[];
  if (rows.length === 0) return null;
  const targets = new Set<string>();
  for (const row of rows) {
    const target = row.toPath ?? row.raw;
    if (target !== null) targets.add(target);
  }
  return { path, targets };
}

export function takeSnapshots(
  db: Database.Database,
  paths: Iterable<VaultPath>,
): Map<VaultPath, NoteSnapshot | null> {
  const out = new Map<VaultPath, NoteSnapshot | null>();
  for (const p of paths) if (!out.has(p)) out.set(p, takeSnapshot(db, p));
  return out;
}

const sorted = (values: Iterable<string>) => [...values].sort();

/**
 * Events for one note. Creation lists its links; deletion only the note (its links go with it);
 * rename and edit list the link differences under the current path.
 */
export function diffSnapshots(
  ts: string,
  before: NoteSnapshot | null,
  after: NoteSnapshot | null,
  renamedFrom?: VaultPath,
): IndexEvent[] {
  const events: IndexEvent[] = [];
  if (!before && !after) return events;
  if (before && !after) return [{ ts, event: 'note_deleted', path: before.path }];
  const current = after as NoteSnapshot;
  if (!before) events.push({ ts, event: 'note_created', path: current.path });
  else if (renamedFrom !== undefined && renamedFrom !== current.path)
    events.push({ ts, event: 'note_renamed', path: current.path, oldPath: renamedFrom });
  const old = before?.targets ?? new Set<string>();
  for (const target of sorted(old))
    if (!current.targets.has(target))
      events.push({ ts, event: 'link_removed', path: current.path, target });
  for (const target of sorted(current.targets))
    if (!old.has(target)) events.push({ ts, event: 'link_added', path: current.path, target });
  return events;
}
