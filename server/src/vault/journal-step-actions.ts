import path from 'node:path';
import { readCopy } from './journal-store.js';
import {
  entryNames,
  isOccupied,
  nameVariants,
  sameFileRenameDir,
  stepSlots,
  type Slot,
} from './journal-step-slots.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { assertNotSymlink, type VaultCore } from './vault-core.js';
import { ensureFolders, moveVaultFile, writeVaultFile } from './vault-disk-io.js';
import { alreadyExists, conflict } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import type { VaultChange, VaultPath } from './vault-types.js';

/** Re-reads the file right before touching it: the step only runs on the revision it planned for. */
async function requireRevision(abs: string, revision: string, vaultPath: VaultPath): Promise<void> {
  const current = await readFileState(abs);
  if (current?.revision !== revision) throw conflict(vaultPath, current);
}

function changeFor(step: JournalStep, direction: 'forward' | 'reverse'): VaultChange {
  const origin = 'app' as const;
  const forward = direction === 'forward';
  const revision = forward ? step.afterRevision : step.expectedRevision;
  switch (step.kind) {
    case 'write':
      return { kind: 'written', path: step.path, revision, origin };
    case 'rename':
      return forward
        ? { kind: 'renamed', path: step.newPath!, oldPath: step.path, revision, origin }
        : { kind: 'renamed', path: step.path, oldPath: step.newPath!, revision, origin };
    case 'trash':
      return forward
        ? { kind: 'deleted', path: step.path, origin }
        : { kind: 'created', path: step.path, revision, origin };
    case 'restore':
      return forward
        ? { kind: 'created', path: step.newPath!, revision, origin }
        : { kind: 'deleted', path: step.newPath!, origin };
  }
}

/**
 * Case-only / NFC-only rename: old name → interim name → new name, resumable from the middle.
 * Right before the second half the folder is listed again: if any file now carries the name in
 * any spelling (someone re-created the "missing" note), the step stops instead of replacing it.
 */
async function moveSameFile(core: VaultCore, step: JournalStep, forward: boolean): Promise<void> {
  const { dir, names, newName } = await sameFileRenameDir(core, step);
  const [startName, endName] = forward ? [step.fromName!, newName] : [newName, step.fromName!];
  const landing = forward ? step.newPath! : step.path;
  const revision = forward ? step.expectedRevision : step.afterRevision;
  const temp = path.join(dir, step.viaTemp!);
  if (names.includes(step.viaTemp!)) {
    await requireRevision(temp, revision, step.path);
  } else {
    await requireRevision(path.join(dir, startName), revision, forward ? step.path : landing);
    await moveVaultFile(core, step.path, path.join(dir, startName), temp);
  }
  if (nameVariants(await entryNames(dir), step, newName).length > 0) throw alreadyExists(landing);
  await moveVaultFile(core, step.path, temp, path.join(dir, endName));
}

/** Moves the file from one slot to the other after checking both ends. */
async function moveBetween(
  core: VaultCore,
  step: JournalStep,
  source: Slot,
  target: Slot,
  revision: string,
  sourcePath: VaultPath,
  targetPath: VaultPath,
): Promise<void> {
  await requireRevision(source.abs, revision, sourcePath);
  if (await isOccupied(target)) throw alreadyExists(targetPath);
  if (target.location) await ensureFolders(core, target.location, false);
  await moveVaultFile(core, step.path, source.abs, target.abs);
}

export async function applyStep(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
): Promise<void> {
  if (step.viaTemp) {
    await moveSameFile(core, step, true);
  } else {
    const { from, to } = await stepSlots(core, entry, step);
    if (step.kind === 'write') {
      if (from.location) await assertNotSymlink(from.location, step.path);
      await requireRevision(from.abs, step.expectedRevision, step.path);
      await writeVaultFile(core, step.path, from.abs, await readCopy(core, entry.id, step.after!));
    } else {
      const targetPath = step.newPath ?? step.path;
      await moveBetween(core, step, from, to, step.expectedRevision, step.path, targetPath);
    }
  }
  core.emit(changeFor(step, 'forward'));
}

export async function revertStep(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
): Promise<void> {
  if (step.viaTemp) {
    await moveSameFile(core, step, false);
  } else {
    const { from, to } = await stepSlots(core, entry, step);
    if (step.kind === 'write') {
      if (from.location) await assertNotSymlink(from.location, step.path);
      await requireRevision(from.abs, step.afterRevision, step.path);
      await writeVaultFile(core, step.path, from.abs, await readCopy(core, entry.id, step.before!));
    } else {
      const placedAt = step.newPath ?? step.path;
      await moveBetween(core, step, to, from, step.afterRevision, placedAt, step.path);
    }
  }
  core.emit(changeFor(step, 'reverse'));
}
