/**
 * Autosave (SPEC §5, F3.4): writes the text of record at the base revision, but only when it
 * differs from the base (P1: no edit, no write). "Đã lưu" appears only once the server answered
 * with the new revision. Failures keep the draft and retry with backoff; a 409 opens the conflict.
 */
import { noteConflictDetails } from '../../lib/api-client';
import { classifySaveError, retriesOnItsOwn, retryDelayMs } from './save-errors';
import { diskFromConflictDetails, enterConflict } from './session-conflict';
import type { RecordText } from './note-session-types';
import type { SessionCore } from './session-core';

function applySaved(
  core: SessionCore,
  record: RecordText,
  revision: string,
  seq: number,
  docVersion: number,
): void {
  core.setBase(record.text, revision);
  // The returned snapshot describes the written text: the next save stays local, no re-parse.
  // Only for the document it was made from: a document loaded meanwhile (source mode, reload)
  // has its own snapshot, and pairing it with this one would bring old bytes back.
  if (record.snapshot && core.docVersion === docVersion) core.snapshot = record.snapshot;
  if (!record.exact && record.snapshot) {
    // Some edit had no exact Markdown form: the file now says something the editor does not show.
    console.debug('note saved with canonical Markdown; reloading the editor from it', core.path);
    core.reloadAfterSave = true;
  }
  core.lastSaved = true;
  core.error = null;
  core.retryAttempt = 0;
  core.clearTimer('retryTimer');
  if (core.changeSeq === seq) {
    core.synced = true;
    core.removeDraft();
    // Show what is on disk (only when nothing was typed meanwhile, so no keystroke is lost).
    if (core.reloadAfterSave && !core.source) core.loadDoc(record.text, { keepSelection: true });
    return;
  }
  // Typed while the request was on its way: the draft must now point at the new revision.
  core.resync();
  if (core.synced) {
    core.removeDraft();
  } else {
    core.writeDraftNow();
    core.restartAutosave();
  }
}

export function handleSaveFailure(core: SessionCore, error: unknown): void {
  const details = noteConflictDetails(error);
  if (details) {
    enterConflict(core, diskFromConflictDetails(details));
    return;
  }
  core.error = classifySaveError(error);
  if (retriesOnItsOwn(core.error)) {
    core.scheduleRetry(retryDelayMs(core.retryAttempt));
    core.retryAttempt += 1;
  }
  core.writeDraftNow();
}

/**
 * Runs inside the note's queue. Resolves true when the disk holds the text of record (also when
 * nothing had to be written), false when the save failed or is blocked by a conflict.
 */
export async function saveInQueue(core: SessionCore): Promise<boolean> {
  if (core.phase !== 'ready' || core.conflict) return false;
  if (core.readOnly) return true;
  const expectedRevision = core.baseRevision;
  if (expectedRevision === null) return false;
  core.clearTimer('autosaveTimer');
  const seq = core.changeSeq;
  const docVersion = core.docVersion;
  const record = core.record();
  if (record.text === core.baseText) {
    core.synced = true;
    core.error = null;
    core.retryAttempt = 0;
    core.clearTimer('retryTimer');
    core.removeDraft();
    core.emit();
    return true;
  }
  const path = core.path;
  let outcome: 'saved' | 'moved' | 'failed' = 'failed';
  core.inFlight += 1;
  core.emit();
  try {
    const { revision } = await core.deps.api.putNote({
      path,
      content: record.text,
      expectedRevision,
    });
    applySaved(core, record, revision, seq, docVersion);
    outcome = 'saved';
  } catch (error) {
    if (core.path !== path && noteConflictDetails(error)?.currentRevision === null) {
      // Renamed elsewhere while the request was on its way: write again at the new path.
      outcome = 'moved';
    } else {
      handleSaveFailure(core, error);
    }
  } finally {
    core.inFlight -= 1;
    core.emit();
  }
  if (outcome === 'moved') return saveInQueue(core);
  return outcome === 'saved';
}
