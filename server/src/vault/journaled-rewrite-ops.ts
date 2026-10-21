import { runForward } from './journal-runner.js';
import { saveJournal } from './journal-store.js';
import type { JournalEntry } from './journal-types.js';
import { writeSteps } from './rename-plan.js';
import { applyTextPatches } from './text-range-patches.js';
import type { VaultCore } from './vault-core.js';
import { decodeStrict, revisionOf } from './vault-errors.js';
import type {
  JournaledRewrite,
  JournaledRewriteOp,
  PatchPlanner,
} from './vault-operation-types.js';
import type { VaultPath } from './vault-types.js';
import { readAtRevision } from './vault-write-ops.js';

/**
 * A single-file content rewrite recorded in the journal (SPEC §4.12) so the UI's 10 s undo can
 * revert it through `undoJournal`, revision-checked like every journaled operation: rescheduling
 * a deadline or a task date. The patches are computed from the bytes at the expected revision;
 * the before/after copies are saved first, then the write runs as the entry's only step. A plan
 * that changes nothing writes nothing and creates no entry.
 */
export function rewriteJournaled(
  core: VaultCore,
  input: VaultPath,
  expectedRevision: string,
  plan: PatchPlanner,
  op: JournaledRewriteOp,
): Promise<JournaledRewrite> {
  return core.queue.run(async () => {
    const { target, current } = await readAtRevision(core, input, expectedRevision);
    const text = decodeStrict(current)!;
    const patches = plan(text);
    const next = patches.length === 0 ? text : applyTextPatches(text, patches);
    const after = Buffer.from(next, 'utf8');
    if (after.equals(current)) {
      return {
        path: target.vaultPath,
        revision: revisionOf(current),
        journalId: null,
        content: text,
      };
    }
    const id = core.newId();
    const steps = await writeSteps(core, id, [{ path: target.vaultPath, before: current, after }]);
    const now = core.now().toISOString();
    const entry: JournalEntry = {
      id,
      op,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      steps,
    };
    await saveJournal(core, entry);
    await runForward(core, entry);
    return { path: target.vaultPath, revision: revisionOf(after), journalId: id, content: next };
  });
}
