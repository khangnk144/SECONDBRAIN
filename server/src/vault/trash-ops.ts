import { rm } from 'node:fs/promises';
import { guardVaultPath } from '../security/path-guard.js';
import { runForward } from './journal-runner.js';
import { isPending, listJournals, saveJournal } from './journal-store.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { listTrashEntries, readTrashEntry, trashEntryDir, trashFileAbs } from './trash-store.js';
import { createFailureTally } from './housekeeping-tally.js';
import { assertNotSymlink, resolveFile, resolvePath, type VaultCore } from './vault-core.js';
import { conflict, notFound, validation } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { withNameSuffix } from './vault-write-ops.js';
import { VaultError, type TrashEntry, type TrashReason, type VaultPath } from './vault-types.js';

const TRASH_REASONS: ReadonlySet<string> = new Set([
  'user',
  'conflict',
  'sample-data',
  'restore-collision',
]);
const MAX_RESTORE_SUFFIX = 9999;

function moveStep(kind: 'trash' | 'restore', path: VaultPath, revision: string): JournalStep {
  return {
    kind,
    path,
    expectedRevision: revision,
    afterRevision: revision,
    before: null,
    after: null,
    applied: false,
  };
}

async function startEntry(
  core: VaultCore,
  op: 'trash' | 'restore',
  id: string,
  steps: JournalStep[],
  trash: TrashEntry,
): Promise<void> {
  const now = core.now().toISOString();
  const entry: JournalEntry = {
    id,
    op,
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    steps,
    trash,
  };
  await saveJournal(core, entry);
  await runForward(core, entry);
}

/**
 * Moves files into one new trash entry (`trash/<ulid>/files/<path>` + meta.json). Every revision is
 * checked before the first file moves; nothing is ever unlinked.
 */
export function trashFiles(
  core: VaultCore,
  inputs: VaultPath[],
  expectedRevisions: string[],
  reason: TrashReason,
): Promise<{ journalId: string; trashId: string }> {
  return core.queue.run(async () => {
    if (!Array.isArray(inputs) || inputs.length === 0) throw validation('No files to trash');
    if (!Array.isArray(expectedRevisions) || expectedRevisions.length !== inputs.length) {
      throw validation('One expected revision per file is required');
    }
    if (!TRASH_REASONS.has(reason)) throw validation('Unknown trash reason', { reason });
    const seen = new Set<string>();
    const steps: JournalStep[] = [];
    for (const [i, input] of inputs.entries()) {
      const found = await resolveFile(core, input);
      await assertNotSymlink(found, input);
      const location = await resolvePath(core, found.vaultPath, 'real');
      const key = location.vaultPath.toLowerCase();
      if (seen.has(key))
        throw validation('The same file is listed twice', { path: location.vaultPath });
      seen.add(key);
      const current = await readFileState(location.abs);
      if (!current) throw notFound(location.vaultPath);
      if (current.revision !== expectedRevisions[i]) throw conflict(location.vaultPath, current);
      steps.push(moveStep('trash', location.vaultPath, current.revision));
    }
    const id = core.newId();
    const trash: TrashEntry = {
      id: core.newId(),
      opId: id,
      originalPaths: steps.map((step) => step.path),
      reason,
      deletedAt: core.now().toISOString(),
    };
    await startEntry(core, 'trash', id, steps, trash);
    return { journalId: id, trashId: trash.id };
  });
}

/** First free name among `x.md`, `x (restored).md`, `x (restored 2).md`, … */
async function freeRestorePath(
  core: VaultCore,
  original: VaultPath,
  taken: Set<string>,
): Promise<VaultPath> {
  for (let n = 1; n <= MAX_RESTORE_SUFFIX; n += 1) {
    const suffix = n === 1 ? '' : n === 2 ? ' (restored)' : ` (restored ${n - 1})`;
    const location = await resolvePath(core, withNameSuffix(original, suffix), 'real');
    const key = location.vaultPath.toLowerCase();
    if (location.kind === null && !taken.has(key)) {
      taken.add(key);
      return location.vaultPath;
    }
  }
  throw validation('No free name to restore to', { path: original });
}

export function restoreTrashEntry(
  core: VaultCore,
  trashId: string,
): Promise<{ journalId: string; restored: { from: VaultPath; to: VaultPath }[] }> {
  return core.queue.run(async () => {
    const trash = await readTrashEntry(core, trashId);
    if (!trash) throw new VaultError('NOT_FOUND', 'No such trash entry', { trashId });
    const taken = new Set<string>();
    const steps: JournalStep[] = [];
    for (const original of trash.originalPaths) {
      // meta.json is a file on disk like any other: its paths go through the guard too.
      const vaultPath = guardVaultPath(original);
      const current = await readFileState(trashFileAbs(core, trash.id, vaultPath));
      if (!current) continue;
      const step = moveStep('restore', vaultPath, current.revision);
      step.newPath = await freeRestorePath(core, vaultPath, taken);
      steps.push(step);
    }
    if (steps.length === 0)
      throw new VaultError('NOT_FOUND', 'The trash entry is empty', { trashId });
    const id = core.newId();
    await startEntry(core, 'restore', id, steps, trash);
    return {
      journalId: id,
      restored: steps.map((step) => ({ from: step.path, to: step.newPath! })),
    };
  });
}

export function listTrash(core: VaultCore): Promise<TrashEntry[]> {
  return listTrashEntries(core);
}

/**
 * Permanent removal of old entries; entries an unfinished operation still needs are kept. Best
 * effort: an entry that cannot be removed (a file held open by another program) is reported and
 * retried on the next start, it never fails the call.
 */
export function purgeTrash(core: VaultCore, maxAgeDays: number, now: Date): Promise<number> {
  return core.queue.run(async () => {
    if (!Number.isFinite(maxAgeDays) || maxAgeDays < 0) throw validation('Invalid trash age');
    const cutoff = now.getTime() - maxAgeDays * 86_400_000;
    const inUse = new Set(
      (await listJournals(core, core.warn)).filter(isPending).map((entry) => entry.trash?.id),
    );
    const failures = createFailureTally();
    let removed = 0;
    for (const entry of await listTrashEntries(core)) {
      const deletedAt = Date.parse(entry.deletedAt);
      if (inUse.has(entry.id) || !Number.isFinite(deletedAt) || deletedAt >= cutoff) continue;
      try {
        await rm(trashEntryDir(core, entry.id), { recursive: true, force: true });
        removed += 1;
      } catch (error) {
        failures.add(error, entry.id);
      }
    }
    failures.report(core.warn, 'purge old trash entries');
    return removed;
  });
}
