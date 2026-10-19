import { randomBytes } from 'node:crypto';
import { guardVaultPath } from '../security/path-guard.js';
import { runForward } from './journal-runner.js';
import { saveCopy, saveJournal } from './journal-store.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { assertNotSymlink, resolveFile, resolvePath, type VaultCore } from './vault-core.js';
import {
  alreadyExists,
  conflict,
  decodeStrict,
  notFound,
  revisionOf,
  validation,
} from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { renameTempName } from './vault-layout.js';
import type { MultiFileResult, RelinkEdit, RelinkPlan, VaultPath } from './vault-types.js';

interface PlannedWrite {
  path: VaultPath;
  before: Buffer;
  after: Buffer;
}

const lastSegment = (vaultPath: VaultPath) => vaultPath.slice(vaultPath.lastIndexOf('/') + 1);

interface VerifiedEdits {
  others: PlannedWrite[];
  own: PlannedWrite | null;
  /** Files that are not UTF-8: never rewritten (their bytes would be re-encoded). */
  notUtf8: VaultPath[];
}

/** Checks every relink edit against the disk now; the renamed note's own edit goes last. */
async function verifyEdits(
  core: VaultCore,
  edits: RelinkEdit[],
  sourcePath: VaultPath,
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
    if (location.vaultPath === sourcePath) result.own = planned;
    else result.others.push(planned);
  }
  return result;
}

/** Planners may answer with plain edits or with edits plus the notes they skipped. */
async function planRelink(
  core: VaultCore,
  op: { kind: 'rename' | 'move'; from: VaultPath; to: VaultPath },
): Promise<RelinkPlan> {
  if (!core.planner) return { edits: [], skipped: [] };
  const planned = await core.planner.plan(op);
  return Array.isArray(planned) ? { edits: planned, skipped: [] } : planned;
}

async function writeSteps(
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

/**
 * Rename or move one file, journaled. Inside the write queue: check the source revision, refuse an
 * occupied target (a case-only or NFC-only rename of the same file is allowed and done in two
 * steps), ask the relink planner for link rewrites while nothing has changed yet, verify them,
 * write the journal with before/after copies, then apply step by step.
 */
export function renameFile(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: { expectedRevision: string; relink: boolean },
  kind: 'rename' | 'move',
): Promise<MultiFileResult> {
  return core.queue.run(async () => {
    // Found the way reads find it, then re-mapped to the true on-disk names for the comparison
    // with the target (on Windows the request may differ in case from the disk).
    const found = await resolveFile(core, input);
    await assertNotSymlink(found, input);
    const source = await resolvePath(core, found.vaultPath, 'real');
    const current = source.kind === 'file' ? await readFileState(source.abs) : null;
    if (!current) throw notFound(source.vaultPath);
    if (current.revision !== options.expectedRevision) throw conflict(source.vaultPath, current);
    const newName = lastSegment(guardVaultPath(newInput));
    const target = await resolvePath(core, newInput, 'real');
    const sameFile = target.kind !== null && target.abs === source.abs;
    if (target.kind !== null && !sameFile) throw alreadyExists(target.vaultPath);
    const fromName = source.segments[source.segments.length - 1]!;
    if (sameFile && fromName === newName) {
      throw validation('The new name is the same as the old one', { path: source.vaultPath });
    }
    const newPath = sameFile
      ? [...target.segments.slice(0, -1), newName].join('/').normalize('NFC')
      : target.vaultPath;

    const plan = options.relink
      ? await planRelink(core, { kind, from: source.vaultPath, to: newPath })
      : { edits: [], skipped: [] };
    const { others, own, notUtf8 } = await verifyEdits(core, plan.edits, source.vaultPath);
    const skipped = [...new Set([...plan.skipped, ...notUtf8])];
    const id = core.newId();
    const steps = await writeSteps(core, id, own ? [...others, own] : others);
    const revision = own ? revisionOf(own.after) : options.expectedRevision;
    steps.push({
      kind: 'rename',
      path: source.vaultPath,
      newPath,
      expectedRevision: revision,
      afterRevision: revision,
      before: null,
      after: null,
      ...(sameFile ? { viaTemp: renameTempName(randomBytes(6).toString('hex')), fromName } : {}),
      applied: false,
    });
    const now = core.now().toISOString();
    const entry: JournalEntry = {
      id,
      op: kind,
      status: 'planned',
      createdAt: now,
      updatedAt: now,
      steps,
    };
    await saveJournal(core, entry);
    await runForward(core, entry);
    const affected = others.map((write) => write.path);
    return {
      journalId: id,
      path: newPath,
      revision,
      affected,
      ...(skipped.length ? { skipped } : {}),
      ...(plan.unresolvable?.length ? { unresolvable: plan.unresolvable } : {}),
    };
  });
}

/** Move into `folder` (`''` = vault root) keeping the file name. */
export async function moveFileToFolder(
  core: VaultCore,
  input: VaultPath,
  folder: VaultPath,
  options: { expectedRevision: string; relink: boolean },
): Promise<MultiFileResult> {
  const name = lastSegment((await resolveFile(core, input)).vaultPath);
  const target = folder === '' ? name : `${guardVaultPath(folder)}/${name}`;
  return renameFile(core, input, target, options, 'move');
}
