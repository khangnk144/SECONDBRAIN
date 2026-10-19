import {
  isPending,
  listJournals,
  loadJournal,
  saveJournal,
  toPendingEntry,
} from './journal-store.js';
import { applyStep, revertStep } from './journal-step-actions.js';
import { interimPresent, type Overlay } from './journal-step-slots.js';
import { simulateStep, stepState, type StepState } from './journal-step-state.js';
import type { JournalEntry, JournalStep } from './journal-types.js';
import { readTrashEntry, removeTrashEntryIfEmpty, writeTrashMeta } from './trash-store.js';
import type { VaultCore } from './vault-core.js';
import { journalConflict, validation, type JournalConflict } from './vault-errors.js';
import { isSimulatedCrash, SimulatedCrashError } from './vault-faults.js';
import type { PendingJournalEntry } from './vault-types.js';

const appliedCount = (entry: JournalEntry) => entry.steps.filter((step) => step.applied).length;

/** The trash entry's meta.json exists before the first file moves into it. */
async function beforeForward(core: VaultCore, entry: JournalEntry): Promise<void> {
  if (entry.op === 'trash' && entry.trash && !(await readTrashEntry(core, entry.trash.id))) {
    await writeTrashMeta(core, entry.trash);
  }
}

async function afterForward(core: VaultCore, entry: JournalEntry): Promise<void> {
  if (entry.op === 'restore' && entry.trash) await removeTrashEntryIfEmpty(core, entry.trash.id);
}

async function afterUndo(core: VaultCore, entry: JournalEntry): Promise<void> {
  if (!entry.trash) return;
  if (entry.op === 'trash') await removeTrashEntryIfEmpty(core, entry.trash.id);
  if (entry.op === 'restore') await writeTrashMeta(core, entry.trash);
}

/**
 * A conflicting step matters to an undo when it already changed something: it is marked applied,
 * or its file is parked under the interim name of a same-file rename.
 */
async function touched(core: VaultCore, step: JournalStep): Promise<boolean> {
  return step.applied || (await interimPresent(core, step));
}

/**
 * Automatic rollback after a step failed at runtime. Driven by what is on disk, not by the flags,
 * so a step whose flag was not saved yet is reverted too. A failing revert leaves `failed` (still
 * pending). Never throws (except a simulated crash): the caller reports the original error.
 */
async function rollBack(core: VaultCore, entry: JournalEntry): Promise<void> {
  try {
    for (const step of [...entry.steps].reverse()) {
      const { state } = await stepState(core, entry, step, new Map(), 'reverse');
      if (state === 'after' || state === 'temp') await revertStep(core, entry, step);
      else if (state === 'conflict' && (await touched(core, step))) throw new Error('blocked');
      step.applied = false;
      await saveJournal(core, entry);
    }
    await afterUndo(core, entry);
    entry.status = 'undone';
  } catch (error) {
    if (isSimulatedCrash(error)) throw error;
    entry.status = 'failed';
  }
  try {
    await saveJournal(core, entry);
  } catch {
    // The disk refuses even the journal: the entry stays pending as it was last saved.
  }
}

/** Applies the unapplied steps in order, saving progress after each; marks the entry `done`. */
export async function runForward(core: VaultCore, entry: JournalEntry): Promise<void> {
  entry.status = 'running';
  await saveJournal(core, entry);
  try {
    await beforeForward(core, entry);
    for (const step of entry.steps) {
      if (step.applied) continue;
      await applyStep(core, entry, step);
      step.applied = true;
      await saveJournal(core, entry);
      const applied = appliedCount(entry);
      if (core.faults.crashAfterJournalStep?.(entry.id, applied)) {
        throw new SimulatedCrashError(`after journal step ${applied}`);
      }
    }
  } catch (error) {
    if (!isSimulatedCrash(error)) await rollBack(core, entry);
    throw error;
  }
  await afterForward(core, entry);
  entry.status = 'done';
  await saveJournal(core, entry);
}

function conflictOf(result: Extract<StepState, { state: 'conflict' }>): JournalConflict {
  const { path, expectedRevision, currentRevision } = result;
  return { path, expectedRevision, currentRevision };
}

export function completeJournal(core: VaultCore, id: string): Promise<void> {
  return core.queue.run(async () => {
    const entry = await loadJournal(core, id);
    if (entry.status === 'done') return;
    if (entry.status === 'undone') throw validation('Already undone', { journalId: id });
    // Dry run over every remaining step first: either all of them can go ahead, or nothing moves.
    const overlay: Overlay = new Map();
    const conflicts: JournalConflict[] = [];
    for (const step of entry.steps) {
      if (step.applied && entry.status !== 'undoing') continue;
      const result = await stepState(core, entry, step, overlay, 'forward');
      if (result.state === 'conflict') {
        conflicts.push(conflictOf(result));
        continue;
      }
      step.applied = result.state === 'after';
      simulateStep(step, overlay, 'forward');
    }
    if (conflicts.length > 0) throw journalConflict(id, conflicts);
    await runForward(core, entry);
  });
}

export function undoJournal(core: VaultCore, id: string): Promise<void> {
  return core.queue.run(async () => {
    const entry = await loadJournal(core, id);
    if (entry.status === 'undone') throw validation('Already undone', { journalId: id });
    const overlay: Overlay = new Map();
    const conflicts: JournalConflict[] = [];
    const toRevert = new Set<JournalStep>();
    for (const step of [...entry.steps].reverse()) {
      const result = await stepState(core, entry, step, overlay, 'reverse');
      if (result.state === 'after' || result.state === 'temp') {
        toRevert.add(step);
        simulateStep(step, overlay, 'reverse');
      } else if (result.state === 'conflict' && (await touched(core, step))) {
        conflicts.push(conflictOf(result));
      }
    }
    if (conflicts.length > 0) throw journalConflict(id, conflicts);
    entry.status = 'undoing';
    await saveJournal(core, entry);
    let reverted = 0;
    try {
      for (const step of [...entry.steps].reverse()) {
        if (toRevert.has(step)) await revertStep(core, entry, step);
        step.applied = false;
        await saveJournal(core, entry);
        if (!toRevert.has(step)) continue;
        reverted += 1;
        if (core.faults.crashAfterUndoStep?.(entry.id, reverted)) {
          throw new SimulatedCrashError(`after undo step ${reverted}`);
        }
      }
    } catch (error) {
      if (!isSimulatedCrash(error)) {
        entry.status = 'failed';
        await saveJournal(core, entry);
      }
      throw error;
    }
    await afterUndo(core, entry);
    entry.status = 'undone';
    await saveJournal(core, entry);
  });
}

export async function pendingJournal(core: VaultCore): Promise<PendingJournalEntry[]> {
  return (await listJournals(core, core.warn)).filter(isPending).map(toPendingEntry);
}
