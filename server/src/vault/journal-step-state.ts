import {
  nameVariants,
  revisionAt,
  revisionOfEntry,
  sameFileRenameDir,
  slotKeys,
  stepSlots,
  type Overlay,
} from './journal-step-slots.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import type { VaultCore } from './vault-core.js';
import type { VaultPath } from './vault-types.js';

export type Direction = 'forward' | 'reverse';

/**
 * Where a step stands on disk, judged only by revisions (never by the `applied` flag, which a crash
 * can leave one step behind): `before` = ready to apply, `after` = applied, `temp` = a same-file
 * rename stopped between its two halves, `conflict` = something else is in the way. A conflict
 * names the file that blocks going in `direction` and the revision expected there (null = the
 * place should be empty).
 */
export type StepState =
  | { state: 'before' | 'after' | 'temp' }
  | {
      state: 'conflict';
      path: VaultPath;
      expectedRevision: string | null;
      currentRevision: string | null;
    };

function blocked(
  path: VaultPath,
  expectedRevision: string | null,
  currentRevision: string | null,
): StepState {
  return { state: 'conflict', path, expectedRevision, currentRevision };
}

async function sameFileRenameState(
  core: VaultCore,
  step: JournalStep,
  overlay: Overlay,
  direction: Direction,
): Promise<StepState> {
  const { dir, names, newName } = await sameFileRenameDir(core, step);
  const variants = nameVariants(names, step, newName);
  // The name about to be (re)taken: the new one going forward, the old one going back.
  const landing = direction === 'forward' ? step.newPath! : step.path;
  if (names.includes(step.viaTemp!)) {
    const revision = await revisionOfEntry(dir, step.viaTemp!);
    if (revision !== step.expectedRevision)
      return blocked(step.path, step.expectedRevision, revision);
    // The note is parked: any file under its name was created meanwhile and must not be replaced.
    if (variants.length > 0)
      return blocked(landing, null, await revisionOfEntry(dir, variants[0]!));
    return { state: 'temp' };
  }
  if (variants.length === 1 && variants[0] === newName) {
    const revision = await revisionOfEntry(dir, newName);
    if (revision === step.afterRevision) return { state: 'after' };
    return blocked(step.newPath!, step.afterRevision, revision);
  }
  if (variants.length === 1 && variants[0] === step.fromName) {
    const key = slotKeys(step).fromKey;
    const revision = overlay.has(key)
      ? overlay.get(key)!
      : await revisionOfEntry(dir, step.fromName!);
    if (revision === step.expectedRevision) return { state: 'before' };
    return blocked(step.path, step.expectedRevision, revision);
  }
  if (variants.length === 0) return blocked(step.path, step.expectedRevision, null);
  // Several spellings, or a third one: another file holds the name.
  const other = variants.find((name) => name !== newName && name !== step.fromName) ?? variants[0]!;
  return blocked(landing, null, await revisionOfEntry(dir, other));
}

export async function stepState(
  core: VaultCore,
  entry: JournalEntry,
  step: JournalStep,
  overlay: Overlay,
  direction: Direction,
): Promise<StepState> {
  if (step.viaTemp) return sameFileRenameState(core, step, overlay, direction);
  const { from, to } = await stepSlots(core, entry, step);
  const fromRevision = await revisionAt(from, overlay);
  if (step.kind === 'write') {
    if (fromRevision === step.afterRevision) return { state: 'after' };
    if (fromRevision === step.expectedRevision) return { state: 'before' };
    const expected = direction === 'forward' ? step.expectedRevision : step.afterRevision;
    return blocked(step.path, expected, fromRevision);
  }
  const toRevision = await revisionAt(to, overlay);
  if (fromRevision === null && toRevision === step.afterRevision) return { state: 'after' };
  if (toRevision === null && fromRevision === step.expectedRevision) return { state: 'before' };
  const target = step.newPath ?? step.path;
  if (direction === 'forward') {
    return fromRevision === step.expectedRevision
      ? blocked(target, null, toRevision) // the destination is taken
      : blocked(step.path, step.expectedRevision, fromRevision);
  }
  return toRevision === step.afterRevision
    ? blocked(step.path, null, fromRevision) // the original place is taken
    : blocked(target, step.afterRevision, toRevision);
}

/** Records in the overlay what applying (`forward`) or reverting the step would leave on disk. */
export function simulateStep(step: JournalStep, overlay: Overlay, direction: Direction): void {
  const { fromKey, toKey } = slotKeys(step);
  if (direction === 'forward') {
    overlay.set(fromKey, null);
    overlay.set(toKey, step.afterRevision);
  } else {
    overlay.set(toKey, null);
    overlay.set(fromKey, step.expectedRevision);
  }
}
