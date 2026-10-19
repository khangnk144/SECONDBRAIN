/** Taking the disk version into the session: silent reloads, reloads after a conflict, deletion. */
import type { NoteResponse } from '../../lib/api/notes-types';
import type { SessionCore } from './session-core';
import { makeSourceState } from './session-source-mode';

/** The editor now shows `text` = the disk at `revision`; no unsaved changes remain. */
export function applyDiskText(
  core: SessionCore,
  text: string,
  revision: string,
  keepSelection: boolean,
): void {
  const inSource = core.source !== null;
  core.setBase(text, revision);
  core.loadDoc(text, { keepSelection });
  if (inSource) core.source = makeSourceState(core, text);
  core.changeSeq += 1;
  core.synced = true;
  core.lastSaved = false;
  core.error = null;
  core.retryAttempt = 0;
  core.restored = null;
  core.clearTimers();
  core.removeDraft();
  core.emit();
}

export function applyNote(core: SessionCore, note: NoteResponse, keepSelection: boolean): void {
  core.readOnly = !note.utf8;
  core.noteClass = note.class;
  applyDiskText(core, note.content, note.revision, keepSelection);
}

/** The note no longer exists and nothing of ours is left to protect. */
export function markGone(core: SessionCore): void {
  core.phase = 'not-found';
  core.conflict = null;
  core.source = null;
  core.restored = null;
  core.clearTimers();
  core.removeDraft();
  core.emit();
}
