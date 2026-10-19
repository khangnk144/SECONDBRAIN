import { randomBytes } from 'node:crypto';
import { guardVaultPath } from '../security/path-guard.js';
import { runForward } from './journal-runner.js';
import { saveJournal } from './journal-store.js';
import type { JournalEntry } from './journal-types.js';
import {
  planNoteRelink,
  relinkOutcome,
  verifyEdits,
  writeSteps,
  type RelinkOutcome,
  type VerifiedEdits,
} from './rename-plan.js';
import { assertNotSymlink, resolveFile, resolvePath, type VaultCore } from './vault-core.js';
import { alreadyExists, conflict, notFound, revisionOf, validation } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { renameTempName } from './vault-layout.js';
import type { DiskLocation } from './vault-disk-names.js';
import type { MultiFileResult, RenamePreview, VaultPath } from './vault-types.js';

type RenameKind = 'rename' | 'move';
interface RenameOptions {
  expectedRevision: string;
  relink: boolean;
}

const lastSegment = (vaultPath: VaultPath) => vaultPath.slice(vaultPath.lastIndexOf('/') + 1);

interface PreparedRename {
  source: DiskLocation;
  newPath: VaultPath;
  /** Case-only or NFC-only rename of the same file: done in two steps through an interim name. */
  sameFile: boolean;
  edits: VerifiedEdits;
  outcome: RelinkOutcome;
}

/**
 * Everything a rename checks and plans, inside the write queue and before any file is touched:
 * the source revision, an occupied target (a case-only or NFC-only rename of the same file is
 * allowed), and the link rewrites while the vault still shows the pre-operation state.
 */
async function prepareRename(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: RenameOptions,
  kind: RenameKind,
): Promise<PreparedRename> {
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
  if (sameFile && source.segments[source.segments.length - 1] === newName) {
    throw validation('The new name is the same as the old one', { path: source.vaultPath });
  }
  const newPath = sameFile
    ? [...target.segments.slice(0, -1), newName].join('/').normalize('NFC')
    : target.vaultPath;
  const plan = options.relink
    ? await planNoteRelink(core, { kind, from: source.vaultPath, to: newPath })
    : { edits: [], skipped: [] };
  const edits = await verifyEdits(core, plan.edits, source.vaultPath);
  return { source, newPath, sameFile, edits, outcome: relinkOutcome(plan, edits) };
}

/**
 * Rename or move one file, journaled: the planned link rewrites (the renamed note's own last,
 * at its old path) and then the rename, each step recorded before the next one runs.
 */
export function renameFile(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: RenameOptions,
  kind: RenameKind,
): Promise<MultiFileResult> {
  return core.queue.run(async () => {
    const { source, newPath, sameFile, edits, outcome } = await prepareRename(
      core,
      input,
      newInput,
      options,
      kind,
    );
    const { others, own } = edits;
    const id = core.newId();
    const steps = await writeSteps(core, id, own ? [...others, own] : others);
    const revision = own ? revisionOf(own.after) : options.expectedRevision;
    const fromName = source.segments[source.segments.length - 1]!;
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
    return { journalId: id, path: newPath, revision, ...outcome };
  });
}

/** The same checks and plan as renameFile(), and nothing else. */
export function previewRenameFile(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: RenameOptions,
  kind: RenameKind,
): Promise<RenamePreview> {
  return core.queue.run(async () => {
    const { newPath, outcome } = await prepareRename(core, input, newInput, options, kind);
    return { dryRun: true, path: newPath, ...outcome };
  });
}

/** Target path of a move into `folder` (`''` = vault root) keeping the file name. */
async function moveTarget(
  core: VaultCore,
  input: VaultPath,
  folder: VaultPath,
): Promise<VaultPath> {
  const name = lastSegment((await resolveFile(core, input)).vaultPath);
  return folder === '' ? name : `${guardVaultPath(folder)}/${name}`;
}

export async function moveFileToFolder(
  core: VaultCore,
  input: VaultPath,
  folder: VaultPath,
  options: RenameOptions,
): Promise<MultiFileResult> {
  return renameFile(core, input, await moveTarget(core, input, folder), options, 'move');
}

export async function previewMoveToFolder(
  core: VaultCore,
  input: VaultPath,
  folder: VaultPath,
  options: RenameOptions,
): Promise<RenamePreview> {
  return previewRenameFile(core, input, await moveTarget(core, input, folder), options, 'move');
}
