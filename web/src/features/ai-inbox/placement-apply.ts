/**
 * Applying an accepted Inbox proposal (R1) with the existing journaled operations: a move alone
 * is `moveNote`, a new name alone is `renameNote`, both together are one rename into the other
 * folder (the server's rename takes a path in another folder), so one undo toast takes back both.
 * Every path relinks, asks first when other notes would change, and offers undo for 10 s.
 */
import { i18n } from '../../i18n';
import { getNote, postNoteRename, postNoteRenameDryRun } from '../../lib/api/notes-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { moveNote, renameNote, type OperationResult } from '../../lib/note-operations';
import { showOperationError } from '../../lib/operation-errors';
import { acceptName, CANCELLED, FAILED, INVALID } from '../../lib/operation-result';
import { runRelinkFlow } from '../../lib/relink-flow';
import { useTabsStore } from '../../lib/tabs-store';
import { useTreeStore } from '../../lib/tree-store';
import { showJournalUndoToast } from '../../lib/undo-toast';
import { joinPath, noteTitleFromPath, parentFolder, samePath } from '../../lib/vault-paths';

export interface PlacementChoice {
  /** Target folder, or null to stay. */
  folder: string | null;
  /** New title (without `.md`), or null to keep the name. */
  title: string | null;
}

export async function applyPlacement(
  path: VaultPath,
  choice: PlacementChoice,
): Promise<OperationResult> {
  const folder =
    choice.folder !== null && !samePath(choice.folder, parentFolder(path)) ? choice.folder : null;
  const title =
    choice.title !== null && choice.title !== noteTitleFromPath(path) ? choice.title : null;
  if (folder !== null && title !== null) return moveAndRename(path, folder, title);
  if (folder !== null) return moveNote(path, folder);
  if (title !== null) return renameNote(path, title);
  return CANCELLED;
}

async function moveAndRename(path: VaultPath, folder: string, newTitle: string) {
  const title = acceptName(newTitle);
  if (title === null) return INVALID;
  const newPath = joinPath(folder, `${title}${path.slice(-3)}`);
  try {
    const request = {
      path,
      newPath,
      expectedRevision: (await getNote(path)).revision,
      relink: true,
    };
    const result = await runRelinkFlow({
      dryRun: () => postNoteRenameDryRun(request),
      execute: () => postNoteRename(request),
      title: i18n.t('operations.confirm.moveTitle', { title: noteTitleFromPath(path), folder }),
      confirmLabel: i18n.t('operations.confirm.moveConfirm'),
    });
    if (!result) return CANCELLED;
    // The WS event does the same; doing it now keeps tabs and tree right if the socket is down.
    useTabsStore.getState().renamePath(path, result.path);
    useTreeStore.getState().scheduleRefresh();
    const message = i18n.t('ai-actions.inbox.movedRenamed', {
      title: noteTitleFromPath(path),
      folder,
      newTitle: noteTitleFromPath(result.path),
    });
    showJournalUndoToast(message, result.journalId);
    return { ok: true as const, path: result.path };
  } catch (error) {
    showOperationError(error);
    return FAILED;
  }
}
