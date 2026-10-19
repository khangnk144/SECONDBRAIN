/**
 * Folder rename/move and folder trash (SPEC F2, §4.11, §4.12). Both are journaled: the folder
 * moves as one directory step, and a rename then rewrites the links whose meaning would change
 * (the relink planner's rules for every file moving with the folder).
 */
import { randomBytes } from 'node:crypto';
import { guardVaultPath } from '../security/path-guard.js';
import { scanFolderTree, type FolderTree } from './folder-tree-scan.js';
import { runForward } from './journal-runner.js';
import { saveJournal } from './journal-store.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import {
  planMovesRelink,
  relinkOutcome,
  verifyEdits,
  writeSteps,
  type RelinkOutcome,
  type VerifiedEdits,
} from './rename-plan.js';
import { assertNotSymlink, resolvePath, type VaultCore } from './vault-core.js';
import type { DiskLocation } from './vault-disk-names.js';
import { alreadyExists, notFound, validation } from './vault-errors.js';
import { renameTempName, VAULT_FOLDERS } from './vault-layout.js';
import {
  VaultError,
  type FolderRenameResult,
  type FolderTrashResult,
  type RenamePreview,
  type TrashEntry,
  type VaultPath,
} from './vault-types.js';

const key = (vaultPath: VaultPath) => vaultPath.normalize('NFC').toLowerCase();
const STANDARD_FOLDERS = new Set(VAULT_FOLDERS.map(key));
const lastSegment = (vaultPath: VaultPath) => vaultPath.slice(vaultPath.lastIndexOf('/') + 1);

/** An existing, real (not linked) folder that is not one of the standard folders of SPEC §3. */
async function resolveUserFolder(core: VaultCore, input: VaultPath): Promise<DiskLocation> {
  const location = await resolvePath(core, input, 'real');
  if (location.kind !== 'dir') throw notFound(location.vaultPath);
  await assertNotSymlink(location, input);
  if (STANDARD_FOLDERS.has(key(location.vaultPath))) {
    throw new VaultError('FORBIDDEN', 'The standard folders of the vault stay where they are.', {
      path: location.vaultPath,
      reason: 'standard-folder',
    });
  }
  return location;
}

interface PreparedFolderRename {
  source: DiskLocation;
  newPath: VaultPath;
  /** Case-only or NFC-only rename of the same folder (through an interim name, no relink). */
  sameDir: boolean;
  tree: FolderTree;
  edits: VerifiedEdits;
  outcome: RelinkOutcome;
}

async function prepareFolderRename(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  relink: boolean,
): Promise<PreparedFolderRename> {
  const source = await resolveUserFolder(core, input);
  const requested = guardVaultPath(newInput);
  if (key(requested).startsWith(`${key(source.vaultPath)}/`)) {
    throw validation('A folder cannot be moved into itself', {
      path: source.vaultPath,
      newPath: requested,
      reason: 'inside-source',
    });
  }
  const target = await resolvePath(core, requested, 'real');
  const sameDir = target.kind !== null && target.abs === source.abs;
  if (target.kind !== null && !sameDir) throw alreadyExists(target.vaultPath);
  const newName = lastSegment(requested);
  if (sameDir && source.segments[source.segments.length - 1] === newName) {
    throw validation('The new name is the same as the old one', {
      path: source.vaultPath,
      reason: 'same-name',
    });
  }
  const newPath = sameDir
    ? [...target.segments.slice(0, -1), newName].join('/').normalize('NFC')
    : target.vaultPath;
  const tree = await scanFolderTree(source.abs);
  const moves = tree.files.map((file) => ({
    from: `${source.vaultPath}/${file.path}`,
    to: `${newPath}/${file.path}`,
  }));
  // Link identity ignores case and Unicode form: a case-only rename changes no link's meaning.
  const plan = relink && !sameDir ? await planMovesRelink(core, moves) : { edits: [], skipped: [] };
  const edits = await verifyEdits(core, plan.edits, null);
  return { source, newPath, sameDir, tree, edits, outcome: relinkOutcome(plan, edits) };
}

function folderStep(
  kind: 'folder-rename' | 'folder-trash',
  path: VaultPath,
  tree: FolderTree,
): JournalStep {
  return {
    kind,
    path,
    expectedRevision: tree.digest,
    afterRevision: tree.digest,
    before: null,
    after: null,
    files: tree.files,
    folders: tree.folders,
    applied: false,
  };
}

async function runEntry(
  core: VaultCore,
  entry: Omit<JournalEntry, 'status' | 'createdAt' | 'updatedAt'>,
) {
  const now = core.now().toISOString();
  const full: JournalEntry = { ...entry, status: 'planned', createdAt: now, updatedAt: now };
  await saveJournal(core, full);
  await runForward(core, full);
}

/**
 * The folder moves first; the link rewrites follow at the files' new paths, so an undo puts the
 * links back before the folder returns.
 */
export function renameFolder(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: { relink: boolean },
): Promise<FolderRenameResult> {
  return core.queue.run(async () => {
    const { source, newPath, sameDir, tree, edits, outcome } = await prepareFolderRename(
      core,
      input,
      newInput,
      options.relink,
    );
    const id = core.newId();
    const step = { ...folderStep('folder-rename', source.vaultPath, tree), newPath };
    if (sameDir) {
      step.viaTemp = renameTempName(randomBytes(6).toString('hex'));
      step.fromName = source.segments[source.segments.length - 1]!;
    }
    const prefix = `${source.vaultPath}/`;
    const relocated = edits.others.map((write) => ({
      ...write,
      path: write.path.startsWith(prefix)
        ? `${newPath}/${write.path.slice(prefix.length)}`
        : write.path,
    }));
    const steps = [step, ...(await writeSteps(core, id, relocated))];
    await runEntry(core, { id, op: 'folder-rename', steps });
    return { journalId: id, path: newPath, ...outcome };
  });
}

export function previewRenameFolder(
  core: VaultCore,
  input: VaultPath,
  newInput: VaultPath,
  options: { relink: boolean },
): Promise<RenamePreview> {
  return core.queue.run(async () => {
    const { newPath, outcome } = await prepareFolderRename(core, input, newInput, options.relink);
    return { dryRun: true, path: newPath, ...outcome };
  });
}

/** One trash entry for the whole folder, keeping the relative structure of everything inside. */
export function trashFolder(core: VaultCore, input: VaultPath): Promise<FolderTrashResult> {
  return core.queue.run(async () => {
    const source = await resolveUserFolder(core, input);
    const tree = await scanFolderTree(source.abs);
    const id = core.newId();
    const paths = tree.files.map((file) => `${source.vaultPath}/${file.path}`);
    const trash: TrashEntry = {
      id: core.newId(),
      opId: id,
      // An empty folder still needs a name in the entry (meta.json lists at least one path).
      originalPaths: paths.length > 0 ? paths : [source.vaultPath],
      reason: 'user',
      deletedAt: core.now().toISOString(),
      folders: [source.vaultPath, ...tree.folders.map((folder) => `${source.vaultPath}/${folder}`)],
    };
    await runEntry(core, {
      id,
      op: 'folder-trash',
      steps: [folderStep('folder-trash', source.vaultPath, tree)],
      trash,
    });
    return { journalId: id, trashId: trash.id, paths };
  });
}
