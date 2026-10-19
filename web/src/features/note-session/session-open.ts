/**
 * Opening a note (F3.5): read the disk and the draft together. A draft typed on the current
 * revision is restored (banner); a draft typed on another revision opens the conflict screen
 * with the base unknown; a draft equal to the disk is stale and dropped.
 */
import { isApiError } from '../../lib/api-client';
import type { NoteResponse } from '../../lib/api/notes-types';
import type { SessionCore } from './session-core';
import { refreshKeptCount } from './session-kept-count';

type Read = { note: NoteResponse } | { error: unknown };

export async function openSession(core: SessionCore): Promise<void> {
  const [read, draft] = await Promise.all([
    core.deps.api.getNote(core.path).then(
      (note): Read => ({ note }),
      (error: unknown): Read => ({ error }),
    ),
    core.deps.drafts.read(core.vaultId, core.path),
  ]);
  if (core.disposed) return;
  // Possibly typed in another (closed or crashed) window: this session now answers for it.
  if (draft) core.drafts.adoptedWindow = draft.windowId;
  if ('error' in read) {
    if (!isApiError(read.error, 'NOT_FOUND')) core.phase = 'failed';
    else if (!draft) core.phase = 'not-found';
    else {
      // Deleted elsewhere, but typed text survived in the draft.
      core.loadDoc(draft.text);
      core.conflict = {
        base: null,
        disk: null,
        mine: draft.text,
        mineBaseRevision: draft.baseRevision,
      };
      core.phase = 'ready';
    }
    core.emit();
    return;
  }
  const { note } = read;
  core.readOnly = !note.utf8;
  core.noteClass = note.class;
  core.setBase(note.content, note.revision);
  if (!draft || draft.text === note.content) {
    if (draft) core.removeDraft();
    core.loadDoc(note.content);
    core.synced = true;
  } else if (draft.baseRevision === note.revision && !core.readOnly) {
    core.loadDoc(draft.text);
    core.restored = { text: note.content };
    core.changeSeq += 1;
    core.synced = false;
    core.draftSeq = core.changeSeq;
    core.restartAutosave();
  } else {
    core.loadDoc(draft.text);
    core.conflict = {
      base: null,
      disk: { revision: note.revision, text: note.utf8 ? note.content : null },
      mine: draft.text,
      mineBaseRevision: draft.baseRevision,
    };
  }
  core.phase = 'ready';
  core.emit();
  void refreshKeptCount(core);
}
