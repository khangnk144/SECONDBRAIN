/**
 * Looking at a version "Tải lại" set aside: it opens on the conflict screen as "mine" against the
 * disk, so restoring it goes through "Giữ bản của tôi" (the disk copy goes to the trash) and
 * letting it go is an explicit choice.
 */
import type { SessionCore } from './session-core';
import { applyDiskText } from './session-disk';
import { saveInQueue } from './session-save';
import { leaveSourceMode } from './session-source-mode';

export async function reviewKept(core: SessionCore): Promise<void> {
  if (core.phase !== 'ready' || core.conflict || core.readOnly) return;
  // Pending edits reach the disk first, so the disk version shown is everything typed.
  if (!(await saveInQueue(core))) return;
  const kept = (await core.deps.drafts.listKept(core.vaultId, core.path)).at(-1);
  const { baseText, baseRevision } = core;
  if (kept?.id === undefined || baseText === null || baseRevision === null) return;
  if (core.source) leaveSourceMode(core);
  core.loadDoc(kept.text);
  core.conflict = {
    base: null,
    disk: { revision: baseRevision, text: baseText },
    mine: kept.text,
    mineBaseRevision: kept.baseRevision,
    keptId: kept.id,
  };
  core.emit();
}

/** "Đóng": back to the note as it is on disk; the set-aside version stays. */
export function closeKeptReview(core: SessionCore): void {
  const { baseText, baseRevision } = core;
  if (core.conflict?.keptId === undefined || baseText === null || baseRevision === null) return;
  core.conflict = null;
  applyDiskText(core, baseText, baseRevision, false);
}
