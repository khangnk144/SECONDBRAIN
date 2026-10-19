import { readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createFailureTally } from './housekeeping-tally.js';
import { PENDING_STATUSES, type JournalEntry } from './journal-types.js';
import { isValidJournalEntry } from './journal-validation.js';
import { isUlid, ulidTime } from './ulid.js';
import {
  readStateJson,
  writeStateFile,
  writeStateJson,
  type VaultCore,
  type VaultWarning,
} from './vault-core.js';
import { VaultError, type PendingJournalEntry, type VaultPath } from './vault-types.js';

/** What the journal files need: the state paths and the clock (no queue, no service). */
type StateHost = Pick<VaultCore, 'paths' | 'now'>;

const jsonPath = (core: StateHost, id: string) => path.join(core.paths.journalDir, `${id}.json`);
const copiesDir = (core: StateHost, id: string) => path.join(core.paths.journalDir, id);

function noSuchJournal(id: string): VaultError {
  return new VaultError('NOT_FOUND', 'No such journal entry', { journalId: id });
}

export async function saveJournal(core: StateHost, entry: JournalEntry): Promise<void> {
  entry.updatedAt = core.now().toISOString();
  await writeStateJson(core.paths, jsonPath(core, entry.id), entry);
}

/** NOT_FOUND for unknown or malformed ids; VALIDATION for an entry that is not as we wrote it. */
export async function loadJournal(core: StateHost, id: string): Promise<JournalEntry> {
  // The id comes from a request: only well-formed ids may become file names.
  if (typeof id !== 'string' || !isUlid(id)) throw noSuchJournal(String(id));
  const value = await readStateJson(jsonPath(core, id));
  if (value === null) throw noSuchJournal(id);
  if (!isValidJournalEntry(value, id)) {
    throw new VaultError('VALIDATION', 'The journal entry is damaged', { journalId: id });
  }
  return value;
}

/** Every readable entry, oldest first; damaged or unreadable ones are reported and skipped. */
export async function listJournals(core: StateHost, warn?: VaultWarning): Promise<JournalEntry[]> {
  let names: string[];
  try {
    names = await readdir(core.paths.journalDir);
  } catch {
    return [];
  }
  const ids = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -5))
    .filter(isUlid)
    .sort();
  const entries: JournalEntry[] = [];
  const skipped = createFailureTally();
  for (const id of ids) {
    try {
      entries.push(await loadJournal(core, id));
    } catch (error) {
      skipped.add(error, id);
    }
  }
  if (warn) skipped.report(warn, 'read journal entries');
  return entries;
}

/** Saved before/after copies are written (and flushed) before the entry that references them. */
export async function saveCopy(
  core: StateHost,
  id: string,
  ref: string,
  bytes: Uint8Array,
): Promise<void> {
  await writeStateFile(core.paths, path.join(copiesDir(core, id), ...ref.split('/')), bytes);
}

export async function readCopy(core: StateHost, id: string, ref: string): Promise<Buffer> {
  return readFile(path.join(copiesDir(core, id), ...ref.split('/')));
}

export function isPending(entry: JournalEntry): boolean {
  return PENDING_STATUSES.has(entry.status);
}

export function toPendingEntry(entry: JournalEntry): PendingJournalEntry {
  const paths = new Set<VaultPath>();
  for (const step of entry.steps) {
    paths.add(step.path);
    if (step.newPath) paths.add(step.newPath);
  }
  return {
    id: entry.id,
    op: entry.op,
    status: entry.status,
    createdAt: entry.createdAt,
    totalSteps: entry.steps.length,
    appliedSteps: entry.steps.filter((step) => step.applied).length,
    paths: [...paths],
  };
}

/**
 * Best-effort cleanup at open: finished (done/undone) entries older than the cutoff, and copy
 * folders whose entry was never written (an operation that failed before its journal was saved).
 * A file that cannot be removed is reported and left for the next open.
 */
export async function pruneFinishedJournals(
  core: StateHost,
  maxAgeDays: number,
  warn: VaultWarning,
): Promise<number> {
  const cutoff = core.now().getTime() - maxAgeDays * 86_400_000;
  const failures = createFailureTally();
  let removed = 0;
  const known = new Set<string>();
  for (const entry of await listJournals(core, warn)) {
    known.add(entry.id);
    if (isPending(entry) || Date.parse(entry.updatedAt) >= cutoff) continue;
    try {
      await rm(copiesDir(core, entry.id), { recursive: true, force: true });
      await rm(jsonPath(core, entry.id), { force: true });
      removed += 1;
    } catch (error) {
      failures.add(error, entry.id);
    }
  }
  let names: string[] = [];
  try {
    names = await readdir(core.paths.journalDir);
  } catch {
    // No journal folder: nothing to prune.
  }
  const jsonNames = new Set(names.filter((name) => name.endsWith('.json')));
  for (const id of names.filter(isUlid)) {
    if (known.has(id) || jsonNames.has(`${id}.json`) || ulidTime(id) >= cutoff) continue;
    try {
      await rm(copiesDir(core, id), { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      failures.add(error, id);
    }
  }
  failures.report(warn, 'prune old journal entries');
  return removed;
}
