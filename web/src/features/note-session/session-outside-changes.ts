/**
 * Changes made elsewhere (another window, another app, a rename): a clean editor reloads silently
 * and keeps the selection; an editor with unsaved edits goes to the conflict screen at once.
 * Checks run in the note's queue, so the echo of our own save is recognised by its revision.
 */
import { isApiError } from '../../lib/api-client';
import type { NoteResponse } from '../../lib/api/notes-types';
import { samePath } from '../../lib/vault-paths';
import type { ClientEvent } from '../../lib/ws/server-event-types';
import { diskFromNote, enterConflict, updateConflictDisk } from './session-conflict';
import type { SessionCore } from './session-core';
import { applyNote, markGone } from './session-disk';

export async function checkDisk(core: SessionCore, revisionHint?: string): Promise<void> {
  if (core.phase !== 'ready') return;
  if (!core.conflict && revisionHint !== undefined && revisionHint === core.baseRevision) return;
  let note: NoteResponse | null;
  try {
    note = await core.deps.api.getNote(core.path);
  } catch (error) {
    if (!isApiError(error, 'NOT_FOUND')) return;
    note = null;
  }
  if (core.phase !== 'ready' || core.disposed) return;
  if (core.conflict) return updateConflictDisk(core, diskFromNote(note));
  if (note && note.revision === core.baseRevision) return;
  if (core.hasUnsavedChanges()) return enterConflict(core, diskFromNote(note));
  if (note) applyNote(core, note, true);
  else markGone(core);
}

export interface OutsideChangeActions {
  /** Re-run the open (after a failed open, or when a missing note appears). */
  reopen(): void;
  /** Save now (after a failure, when the server is back). */
  retrySave(): void;
}

export function handleServerEvent(
  core: SessionCore,
  event: ClientEvent,
  actions: OutsideChangeActions,
): void {
  if (core.disposed) return;
  const queueCheck = (hint?: string) => void core.queue.run(() => checkDisk(core, hint));
  switch (event.type) {
    case 'note:changed':
    case 'note:created':
      if (!samePath(event.path, core.path)) return;
      if (core.phase === 'not-found') return actions.reopen();
      if (event.revision !== core.baseRevision || core.conflict) queueCheck(event.revision);
      return;
    case 'note:deleted':
      if (samePath(event.path, core.path)) queueCheck();
      return;
    case 'note:renamed':
      if (!samePath(event.oldPath, core.path)) return;
      core.setPath(event.path);
      if (event.revision !== core.baseRevision || core.conflict) queueCheck(event.revision);
      return;
    case 'resync':
      // Events may have been missed while the socket was down.
      if (core.phase === 'failed') return actions.reopen();
      if (core.error) actions.retrySave();
      queueCheck();
      return;
    default:
      return;
  }
}
