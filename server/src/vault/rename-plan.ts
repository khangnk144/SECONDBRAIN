/**
 * Shared planning of journaled renames (notes and folders): asking the relink planner while
 * nothing has changed yet, checking every planned rewrite against the disk, and turning the
 * rewrites into journal write steps with their before/after copies.
 */
import { saveCopy } from './journal-store.js';
import type { JournalStep } from './journal-types.js';
import { assertNotSymlink, resolvePath, type VaultCore } from './vault-core.js';
import { conflict, decodeStrict, revisionOf, validation } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import type { RelinkEdit, RelinkPlan, UnresolvableRelink, VaultPath } from './vault-types.js';

export interface PlannedWrite {
  path: VaultPath;
  before: Buffer;
  after: Buffer;
}

export interface VerifiedEdits {
  others: PlannedWrite[];
  /** The renamed note's own rewrite (applied last, at its old path). */
  own: PlannedWrite | null;
  /** Files that are not UTF-8: never rewritten (their bytes would be re-encoded). */
  notUtf8: VaultPath[];
}

/** The relink outcome a rename reports, whether it ran or was only previewed. */
export interface RelinkOutcome {
  affected: VaultPath[];
  skipped?: VaultPath[];
  unresolvable?: UnresolvableRelink[];
}

/** Checks every relink edit against the disk now; `ownPath`'s edit is kept apart. */
export async function verifyEdits(
  core: VaultCore,
  edits: RelinkEdit[],
  ownPath: VaultPath | null,
): Promise<VerifiedEdits> {
  const seen = new Set<string>();
  const result: VerifiedEdits = { others: [], own: null, notUtf8: [] };
  for (const edit of edits) {
    const location = await resolvePath(core, edit.path, 'real');
    const key = location.vaultPath.toLowerCase();
    if (seen.has(key)) {
      throw validation('Relink planned two edits for one file', { path: edit.path });
    }
    seen.add(key);
    await assertNotSymlink(location, edit.path);
    const current = location.kind === 'file' ? await readFileState(location.abs) : null;
    if (current?.revision !== edit.expectedRevision) throw conflict(location.vaultPath, current);
    if (!current.bytes || decodeStrict(current.bytes) === null) {
      result.notUtf8.push(location.vaultPath);
      continue;
    }
    const after = Buffer.from(edit.newContent, 'utf8');
    const planned = { path: location.vaultPath, before: current.bytes, after };
    if (location.vaultPath === ownPath) result.own = planned;
    else result.others.push(planned);
  }
  return result;
}

/** Planners may answer with plain edits or with edits plus the notes they skipped. */
export async function planNoteRelink(
  core: VaultCore,
  op: { kind: 'rename' | 'move'; from: VaultPath; to: VaultPath },
): Promise<RelinkPlan> {
  if (!core.planner) return { edits: [], skipped: [] };
  const planned = await core.planner.plan(op);
  return Array.isArray(planned) ? { edits: planned, skipped: [] } : planned;
}

/** Relink for files moving together (a folder rename); planners without it rewrite nothing. */
export async function planMovesRelink(
  core: VaultCore,
  moves: { from: VaultPath; to: VaultPath }[],
): Promise<RelinkPlan> {
  if (!core.planner?.planMoves || moves.length === 0) return { edits: [], skipped: [] };
  return core.planner.planMoves(moves);
}

export function relinkOutcome(plan: RelinkPlan, verified: VerifiedEdits): RelinkOutcome {
  const skipped = [...new Set([...plan.skipped, ...verified.notUtf8])];
  return {
    affected: verified.others.map((write) => write.path),
    ...(skipped.length ? { skipped } : {}),
    ...(plan.unresolvable?.length ? { unresolvable: plan.unresolvable } : {}),
  };
}

/** Journal write steps for `writes`; their copies are saved before the entry refers to them. */
export async function writeSteps(
  core: VaultCore,
  id: string,
  writes: PlannedWrite[],
): Promise<JournalStep[]> {
  const steps: JournalStep[] = [];
  for (const [n, write] of writes.entries()) {
    const step: JournalStep = {
      kind: 'write',
      path: write.path,
      expectedRevision: revisionOf(write.before),
      afterRevision: revisionOf(write.after),
      before: `before/${n}`,
      after: `after/${n}`,
      applied: false,
    };
    await saveCopy(core, id, step.before!, write.before);
    await saveCopy(core, id, step.after!, write.after);
    steps.push(step);
  }
  return steps;
}
