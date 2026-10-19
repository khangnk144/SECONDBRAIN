/**
 * Conflicts (SPEC §4.10): the disk changed under unsaved edits. The session keeps three versions
 * (base, disk, mine), writes nothing, keeps mine as a draft, and resolves only on the user's
 * choice: "Tải lại" (mine set aside first) or "Giữ bản của tôi" (disk copy goes to the trash).
 */
import { isApiError, noteConflictDetails, type NoteConflictDetails } from '../../lib/api-client';
import type { NoteResponse } from '../../lib/api/notes-types';
import type { ConflictVersions } from './note-session-types';
import type { SessionCore } from './session-core';
import { applyDiskText, applyNote, markGone } from './session-disk';
import { dropKept, refreshKeptCount } from './session-kept-count';
import { leaveSourceMode } from './session-source-mode';

type Disk = ConflictVersions['disk'];

export function diskFromConflictDetails(details: NoteConflictDetails): Disk {
  if (details.currentRevision === null) return null;
  return { revision: details.currentRevision, text: details.currentContent ?? null };
}

export function diskFromNote(note: NoteResponse | null): Disk {
  return note ? { revision: note.revision, text: note.utf8 ? note.content : null } : null;
}

/** The disk now holds exactly mine: nothing to resolve. */
function settleOnDisk(core: SessionCore, mine: string, revision: string): void {
  const keptId = core.conflict?.keptId;
  if (keptId !== undefined) void dropKept(core, keptId);
  core.conflict = null;
  core.setBase(mine, revision);
  core.resync();
  core.lastSaved = true;
  core.removeDraft();
  core.emit();
}

export function enterConflict(core: SessionCore, disk: Disk): void {
  if (core.source) leaveSourceMode(core);
  const mine = core.record().text;
  if (mine === core.baseText) {
    // No edits of ours: just take what the disk has now.
    if (disk === null) return markGone(core);
    if (disk.text !== null) return applyDiskText(core, disk.text, disk.revision, true);
  }
  if (disk && disk.text === mine) {
    settleOnDisk(core, mine, disk.revision);
    return;
  }
  core.conflict = { base: core.baseText, disk, mine, mineBaseRevision: core.baseRevision };
  core.clearTimers();
  core.error = null;
  // Keep mine on its old base, so reopening the note shows the conflict again.
  if (core.baseRevision !== null) core.storeDraft(mine, core.baseRevision);
  core.emit();
}

/** The disk changed again while the conflict screen is open. */
export function updateConflictDisk(core: SessionCore, disk: Disk): void {
  const conflict = core.conflict;
  if (!conflict) return;
  if (disk && disk.text === conflict.mine) {
    settleOnDisk(core, conflict.mine, disk.revision);
    return;
  }
  core.conflict = { ...conflict, disk };
  core.emit();
}

/** "Tải lại": mine is set aside in the browser first, then the disk version is loaded. */
export async function reloadFromDisk(core: SessionCore): Promise<void> {
  const conflict = core.conflict;
  if (!conflict) return;
  // Looking at a set-aside version: "Tải lại" lets that version go.
  if (conflict.keptId !== undefined) await dropKept(core, conflict.keptId);
  const kept =
    conflict.keptId !== undefined ||
    (await core.deps.drafts.keep({
      vaultId: core.vaultId,
      path: core.path,
      baseRevision: conflict.mineBaseRevision,
      text: conflict.mine,
      reason: 'conflict-reload',
      ts: core.deps.now(),
    }));
  if (!kept) {
    core.deps.notify({ kind: 'keep-aside-failed' });
    return;
  }
  let note: NoteResponse | null = null;
  try {
    note = await core.deps.api.getNote(core.path);
  } catch (error) {
    if (!isApiError(error, 'NOT_FOUND')) {
      core.deps.notify({ kind: 'action-failed', error });
      return;
    }
  }
  core.conflict = null;
  if (note) applyNote(core, note, false);
  else markGone(core);
  core.deps.notify({ kind: conflict.keptId === undefined ? 'reloaded' : 'kept-discarded' });
  await refreshKeptCount(core);
}

/** "Giữ bản của tôi": overwrite the disk (its copy goes to the trash) or re-create a deleted note. */
export async function keepMine(core: SessionCore): Promise<void> {
  const conflict = core.conflict;
  if (!conflict) return;
  const { mine, disk } = conflict;
  const api = core.deps.api;
  core.inFlight += 1;
  core.emit();
  try {
    const { revision } =
      disk === null
        ? await api.postNote({ path: core.path, content: mine })
        : await api.putNote({
            path: core.path,
            content: mine,
            expectedRevision: disk.revision,
            conflictCopy: true,
          });
    const record = core.record();
    if (record.text === mine && record.snapshot) core.snapshot = record.snapshot;
    core.restored = null;
    core.error = null;
    settleOnDisk(core, mine, revision);
    if (!core.synced) core.restartAutosave();
    core.deps.notify({ kind: 'kept-mine' });
  } catch (error) {
    await refreshAfterFailedKeep(core, error);
  } finally {
    core.inFlight -= 1;
    core.emit();
  }
}

async function refreshAfterFailedKeep(core: SessionCore, error: unknown): Promise<void> {
  const details = noteConflictDetails(error);
  if (details) {
    updateConflictDisk(core, diskFromConflictDetails(details));
    core.deps.notify({ kind: 'disk-changed-again' });
    return;
  }
  if (isApiError(error, 'EXISTS')) {
    try {
      updateConflictDisk(core, diskFromNote(await core.deps.api.getNote(core.path)));
      core.deps.notify({ kind: 'disk-changed-again' });
      return;
    } catch {
      // Fall through to the generic message.
    }
  }
  core.deps.notify({ kind: 'action-failed', error });
}
