/**
 * The only place the UI performs vault operations (sidebar, note title, ghost links, Alt+N).
 * Every operation validates names first, asks before rewriting other notes (dry run + confirm),
 * reports failures as friendly toasts and offers undo for 10 s through the journal.
 */
import { i18n } from '../i18n';
import {
  getNote,
  postNoteMove,
  postNoteMoveDryRun,
  postNoteRename,
  postNoteRenameDryRun,
  postNoteTrash,
} from './api/notes-api';
import type { VaultPath } from './api/vault-types';
import { postReveal } from './api/vault-api';
import { showOperationError, type OperationSubject } from './operation-errors';
import {
  acceptName,
  CANCELLED,
  FAILED,
  INVALID,
  type OperationResult,
  type RevisionOption,
} from './operation-result';
import { runRelinkFlow } from './relink-flow';
import { expectTabRemoval, useTabsStore } from './tabs-store';
import { useTreeStore } from './tree-store';
import { showJournalUndoToast } from './undo-toast';
import { ARCHIVE_FOLDER, joinPath, noteTitleFromPath, parentFolder, samePath } from './vault-paths';

export * from './folder-operations';
export { createNote, type CreateNoteOptions } from './note-create-operation';
export type { OperationResult, RevisionOption } from './operation-result';

async function revisionOf(path: VaultPath, given?: string): Promise<string> {
  return given ?? (await getNote(path)).revision;
}

function afterMove(oldPath: VaultPath, newPath: VaultPath) {
  // The WS event does the same; doing it now keeps the UI right even when the socket is down.
  useTabsStore.getState().renamePath(oldPath, newPath);
  useTreeStore.getState().scheduleRefresh();
}

/** Renames in place (same folder) with relink. `newTitle` is the title, without `.md`. */
export async function renameNote(
  path: VaultPath,
  newTitle: string,
  options: RevisionOption = {},
): Promise<OperationResult> {
  const title = acceptName(newTitle);
  if (title === null) return INVALID;
  if (title === noteTitleFromPath(path)) return { ok: true, path };
  const newPath = joinPath(parentFolder(path), `${title}${path.slice(-3)}`);
  try {
    const request = {
      path,
      newPath,
      expectedRevision: await revisionOf(path, options.expectedRevision),
      relink: true,
    };
    const result = await runRelinkFlow({
      dryRun: () => postNoteRenameDryRun(request),
      execute: () => postNoteRename(request),
      title: i18n.t('operations.confirm.renameTitle', { title: noteTitleFromPath(path) }),
      confirmLabel: i18n.t('operations.confirm.renameConfirm'),
    });
    if (!result) return CANCELLED;
    afterMove(path, result.path);
    showJournalUndoToast(i18n.t('operations.renamed', { title }), result.journalId);
    return { ok: true, path: result.path };
  } catch (error) {
    showOperationError(error);
    return FAILED;
  }
}

/** Moves into `folder` (`''` = vault root) keeping the name, with relink. */
export async function moveNote(
  path: VaultPath,
  folder: VaultPath,
  options: RevisionOption & { message?: string } = {},
): Promise<OperationResult> {
  if (samePath(parentFolder(path), folder)) return { ok: true, path };
  const title = noteTitleFromPath(path);
  const folderLabel = folder === '' ? i18n.t('operations.rootFolder') : folder;
  try {
    const request = {
      path,
      folder,
      expectedRevision: await revisionOf(path, options.expectedRevision),
      relink: true,
    };
    const result = await runRelinkFlow({
      dryRun: () => postNoteMoveDryRun(request),
      execute: () => postNoteMove(request),
      title: i18n.t('operations.confirm.moveTitle', { title, folder: folderLabel }),
      confirmLabel: i18n.t('operations.confirm.moveConfirm'),
    });
    if (!result) return CANCELLED;
    afterMove(path, result.path);
    const message = options.message ?? i18n.t('operations.moved', { title, folder: folderLabel });
    showJournalUndoToast(message, result.journalId);
    return { ok: true, path: result.path };
  } catch (error) {
    showOperationError(error);
    return FAILED;
  }
}

/** "Chuyển vào Archive": a move to `4 Archive`. */
export function archiveNote(path: VaultPath, options: RevisionOption = {}) {
  const message = i18n.t('operations.archived', { title: noteTitleFromPath(path) });
  return moveNote(path, ARCHIVE_FOLDER, { ...options, message });
}

/** Moves notes to the trash (one entry); their tabs close; undo for 10 s. */
export async function trashNotes(
  paths: VaultPath[],
  options: { expectedRevisions?: string[] } = {},
): Promise<OperationResult> {
  const first = paths[0];
  if (first === undefined) return CANCELLED;
  try {
    const revisions =
      options.expectedRevisions ?? (await Promise.all(paths.map((p) => revisionOf(p))));
    expectTabRemoval(paths);
    const result = await postNoteTrash(paths, revisions);
    useTabsStore.getState().closePaths(paths);
    useTreeStore.getState().scheduleRefresh();
    const message =
      paths.length === 1
        ? i18n.t('operations.trashedOne', { title: noteTitleFromPath(first) })
        : i18n.t('operations.trashedMany', { count: paths.length });
    showJournalUndoToast(message, result.journalId);
    return { ok: true, path: first };
  } catch (error) {
    showOperationError(error);
    return FAILED;
  }
}

/** Opens the OS file manager with the note or folder selected. */
export async function revealInExplorer(
  path: VaultPath,
  subject: OperationSubject = 'note',
): Promise<void> {
  try {
    await postReveal(path);
  } catch (error) {
    showOperationError(error, subject);
  }
}
