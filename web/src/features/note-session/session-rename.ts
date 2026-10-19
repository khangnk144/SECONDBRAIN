/**
 * Title rename (F3.7) inside the note's queue: save first, rename with relink at that revision,
 * then take the note as the rename left it. Relink may rewrite links inside the note itself, so
 * the new revision becomes the base before any further save; words typed while the rename ran
 * are carried over on top of it.
 */
import { applyPatch, structuredPatch } from 'diff';
import { FAILED, type OperationResult } from '../../lib/operation-result';
import { diskFromNote, enterConflict } from './session-conflict';
import type { SessionCore } from './session-core';
import { applyNote } from './session-disk';
import { checkDisk } from './session-outside-changes';
import { saveInQueue } from './session-save';
import { makeSourceState } from './session-source-mode';

/**
 * The change from `base` to `theirs`, applied to `mine` line by line; null when it does not fit.
 * No context lines: only the lines `theirs` changed must still read the same in `mine`.
 */
export function mergeOnto(base: string, theirs: string, mine: string): string | null {
  const patch = structuredPatch('base', 'theirs', base, theirs, '', '', { context: 0 });
  const merged = applyPatch(mine, patch);
  return merged === false ? null : merged;
}

async function adoptRenamedNote(core: SessionCore): Promise<void> {
  let note;
  try {
    note = await core.deps.api.getNote(core.path);
  } catch {
    // Not readable right now: the next check (queued) settles it like any outside change.
    void core.queue.run(() => checkDisk(core));
    return;
  }
  if (note.revision === core.baseRevision || core.conflict) return;
  const base = core.baseText ?? '';
  const mine = core.record().text;
  if (mine === base) return applyNote(core, note, true);
  const merged = note.utf8 ? mergeOnto(base, note.content, mine) : null;
  if (merged === null) return enterConflict(core, diskFromNote(note));
  const inSource = core.source !== null;
  core.setBase(note.content, note.revision);
  core.loadDoc(merged, { keepSelection: true });
  if (inSource) core.source = makeSourceState(core, merged);
  core.changeSeq += 1;
  core.synced = merged === note.content;
  if (!core.synced) {
    core.writeDraftNow();
    core.restartAutosave();
  }
  core.emit();
}

export async function renameInQueue(core: SessionCore, title: string): Promise<OperationResult> {
  if (core.phase !== 'ready' || core.conflict) return FAILED;
  if (!(await saveInQueue(core))) return FAILED;
  const before = core.path;
  const result = await core.deps.renameNote(before, title, {
    expectedRevision: core.baseRevision ?? undefined,
  });
  // Compare exactly: a case-only rename ("bài 1" → "Bài 1") is a rename too.
  if (!result.ok || result.path === before) return result;
  core.setPath(result.path);
  await adoptRenamedNote(core);
  return result;
}
