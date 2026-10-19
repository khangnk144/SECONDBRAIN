/**
 * Journal steps that move a whole folder (rename/move of a folder, folder to trash). The folder
 * moves as one directory rename, so a crash leaves it either where it was or where it goes; the
 * state is judged by which of the two places holds the folder. Each file inside is reported as
 * its own change so the index and the clients follow.
 */
import path from 'node:path';
import { moveFolder, presenceAt, type Presence } from './folder-move-disk.js';
import { emitFolderChanges, noteRevisionsIn } from './folder-step-changes.js';
import {
  entryNames,
  nameVariants,
  sameFileRenameDir,
  stepSlots,
  type Overlay,
  type Slot,
} from './journal-step-slots.js';
import type { Direction, StepState } from './journal-step-state.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { resolvePath, type VaultCore } from './vault-core.js';
import { ensureFolders } from './vault-disk-io.js';
import { alreadyExists } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { VaultError, type VaultPath } from './vault-types.js';

const blocked = (path: VaultPath, expectedRevision: string | null): StepState => ({
  state: 'conflict',
  path,
  expectedRevision,
  currentRevision: null,
});

async function presence(slot: Slot, overlay: Overlay): Promise<Presence> {
  if (overlay.has(slot.key)) return overlay.get(slot.key) === null ? null : 'dir';
  return presenceAt(slot.abs);
}

async function sameFolderState(
  core: VaultCore,
  step: JournalStep,
  direction: Direction,
): Promise<StepState> {
  const { names, newName } = await sameFileRenameDir(core, step);
  const variants = nameVariants(names, step, newName);
  const landing = direction === 'forward' ? step.newPath! : step.path;
  if (names.includes(step.viaTemp!)) {
    return variants.length > 0 ? blocked(landing, null) : { state: 'temp' };
  }
  if (variants.length === 1 && variants[0] === newName) return { state: 'after' };
  if (variants.length === 1 && variants[0] === step.fromName) return { state: 'before' };
  return variants.length === 0 ? blocked(step.path, step.expectedRevision) : blocked(landing, null);
}

export async function folderStepState(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
  overlay: Overlay,
  direction: Direction,
): Promise<StepState> {
  if (step.viaTemp) return sameFolderState(core, step, direction);
  const { from, to } = await stepSlots(core, entry, step);
  const [source, target] = [await presence(from, overlay), await presence(to, overlay)];
  if (source === 'dir' && target === null) return { state: 'before' };
  if (source === null && target === 'dir') return { state: 'after' };
  // Only a cross-volume move into the trash can leave the folder in both places.
  if (source === 'dir' && target === 'dir' && step.kind === 'folder-trash')
    return { state: 'temp' };
  const destination = step.newPath ?? step.path;
  if (direction === 'forward') {
    return source === 'dir'
      ? blocked(destination, null)
      : blocked(step.path, step.expectedRevision);
  }
  return target === 'dir' ? blocked(step.path, null) : blocked(destination, step.afterRevision);
}

function refusal(state: Extract<StepState, { state: 'conflict' }>): VaultError {
  if (state.expectedRevision === null) return alreadyExists(state.path);
  return new VaultError('CONFLICT', `The folder is no longer there: ${state.path}`, {
    path: state.path,
    currentRevision: null,
  });
}

/** Case-only / NFC-only folder rename: old name → interim name → new name. */
async function moveSameFolder(core: VaultCore, step: JournalStep, direction: Direction) {
  const forward = direction === 'forward';
  const { dir, names, newName } = await sameFileRenameDir(core, step);
  const [startName, endName] = forward ? [step.fromName!, newName] : [newName, step.fromName!];
  const temp = path.join(dir, step.viaTemp!);
  const parked = names.includes(step.viaTemp!);
  const revisions = await noteRevisionsIn(
    parked ? temp : path.join(dir, startName),
    step.files ?? [],
  );
  if (!parked) await moveFolder(core, step.path, path.join(dir, startName), temp, false);
  if (nameVariants(await entryNames(dir), step, newName).length > 0) {
    throw alreadyExists(forward ? step.newPath! : step.path);
  }
  await moveFolder(core, step.path, temp, path.join(dir, endName), false);
  emitFolderChanges(core, step, direction, revisions);
}

/** Moves the folder in `direction` and reports what moved, with nothing awaited in between. */
async function moveWholeFolder(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
  direction: Direction,
): Promise<void> {
  if (step.viaTemp) return moveSameFolder(core, step, direction);
  const state = await folderStepState(core, entry, step, new Map(), direction);
  if (state.state === 'conflict') throw refusal(state);
  const slots = await stepSlots(core, entry, step);
  const [from, to] = direction === 'forward' ? [slots.from, slots.to] : [slots.to, slots.from];
  if (to.location) await ensureFolders(core, to.location, false);
  const revisions = await noteRevisionsIn(from.abs, step.files ?? []);
  await moveFolder(core, step.path, from.abs, to.abs, step.kind === 'folder-trash');
  emitFolderChanges(core, step, direction, revisions);
}

export function applyFolderStep(core: VaultCore, entry: JournalEntry, step: JournalStep) {
  return moveWholeFolder(core, entry, step, 'forward');
}

export function revertFolderStep(core: VaultCore, entry: JournalEntry, step: JournalStep) {
  return moveWholeFolder(core, entry, step, 'reverse');
}

/**
 * Forward dry run: a write step planned inside a renamed folder (the folder step runs first) still
 * finds its file at the folder's old place while that step is only simulated. `undefined` = the
 * step is not inside such a folder.
 */
export async function revisionThroughMovedFolder(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
  overlay: Overlay,
): Promise<string | null | undefined> {
  for (const folder of entry.steps) {
    if (folder.kind !== 'folder-rename' || folder.viaTemp) continue;
    const prefix = `${folder.newPath}/`;
    if (!step.path.startsWith(prefix) || !overlay.get(`v:${folder.newPath}`)) continue;
    const location = await resolvePath(
      core,
      `${folder.path}/${step.path.slice(prefix.length)}`,
      'real',
    );
    return (await readFileState(location.abs))?.revision ?? null;
  }
  return undefined;
}
