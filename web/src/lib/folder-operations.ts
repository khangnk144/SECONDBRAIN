/** Folder operations: create, rename/move (journaled, with relink), trash. */
import { i18n } from '../i18n';
import {
  postFolder,
  postFolderRename,
  postFolderRenameDryRun,
  postFolderTrash,
} from './api/folders-api';
import type { TreeFolder } from './api/tree-types';
import type { VaultPath } from './api/vault-types';
import { confirmDialog } from './dialogs/dialog-requests';
import { showOperationError } from './operation-errors';
import { acceptName, CANCELLED, FAILED, INVALID, type OperationResult } from './operation-result';
import { runRelinkFlow } from './relink-flow';
import { isStandardFolder } from './standard-folders';
import { expectTabRemoval, useTabsStore } from './tabs-store';
import { showToast } from './toast-store';
import { useTreeStore } from './tree-store';
import { showJournalUndoToast, showUndoToast } from './undo-toast';
import {
  ARCHIVE_FOLDER,
  baseName,
  isInsideFolder,
  joinPath,
  parentFolder,
  samePath,
} from './vault-paths';

function folderLabel(path: VaultPath): string {
  return path === '' ? i18n.t('operations.rootFolder') : path;
}

function refuseStandard(path: VaultPath): boolean {
  if (!isStandardFolder(path)) return false;
  showToast({ message: i18n.t('operations.errors.forbidden'), tone: 'error' });
  return true;
}

export async function createFolder(parent: VaultPath, name: string): Promise<OperationResult> {
  const cleaned = acceptName(name);
  if (cleaned === null) return INVALID;
  try {
    const { path } = await postFolder(joinPath(parent, cleaned));
    const tree = useTreeStore.getState();
    if (parent !== '') tree.setExpanded(parent, true);
    tree.scheduleRefresh();
    showUndoToast(i18n.t('operations.folderCreated', { name: baseName(path) }), () =>
      undoCreateFolder(path),
    );
    return { ok: true, path };
  } catch (error) {
    showOperationError(error, 'folder');
    return FAILED;
  }
}

function findFolder(folder: TreeFolder | undefined, path: VaultPath): TreeFolder | null {
  if (!folder) return null;
  if (samePath(folder.path, path)) return folder;
  for (const child of folder.folders) {
    if (isInsideFolder(path, child.path)) return findFolder(child, path);
  }
  return null;
}

/** Undo of "Thư mục mới": only while the folder is still empty (nothing is ever trashed by surprise). */
async function undoCreateFolder(path: VaultPath): Promise<void> {
  const tree = useTreeStore.getState();
  await tree.fetchTree();
  const folder = findFolder(useTreeStore.getState().tree?.root, path);
  if (folder && (folder.files.length > 0 || folder.folders.length > 0)) {
    showToast({ message: i18n.t('operations.undoFolderNotEmpty'), tone: 'error' });
    return;
  }
  try {
    if (folder) await postFolderTrash(path);
    useTreeStore.getState().scheduleRefresh();
    showToast({ message: i18n.t('operations.undone') });
  } catch (error) {
    showOperationError(error, 'folder');
  }
}

async function relocateFolder(
  path: VaultPath,
  newPath: VaultPath,
  texts: { title: string; confirmLabel: string; done: string },
): Promise<OperationResult> {
  try {
    const request = { path, newPath, relink: true };
    const result = await runRelinkFlow({
      dryRun: () => postFolderRenameDryRun(request),
      execute: () => postFolderRename(request),
      title: texts.title,
      confirmLabel: texts.confirmLabel,
    });
    if (!result) return CANCELLED;
    useTreeStore.getState().renameExpanded(path, result.path);
    useTreeStore.getState().scheduleRefresh();
    useTabsStore.getState().renamePath(path, result.path);
    showJournalUndoToast(texts.done, result.journalId);
    return { ok: true, path: result.path };
  } catch (error) {
    showOperationError(error, 'folder');
    return FAILED;
  }
}

export async function renameFolder(path: VaultPath, newName: string): Promise<OperationResult> {
  if (refuseStandard(path)) return INVALID;
  const name = acceptName(newName);
  if (name === null) return INVALID;
  if (name === baseName(path)) return { ok: true, path };
  return relocateFolder(path, joinPath(parentFolder(path), name), {
    title: i18n.t('operations.confirm.folderRenameTitle', { name: baseName(path) }),
    confirmLabel: i18n.t('operations.confirm.renameConfirm'),
    done: i18n.t('operations.folderRenamed', { name }),
  });
}

/** Moves a folder (and everything below it) under `parent` (`''` = vault root). */
export async function moveFolder(
  path: VaultPath,
  parent: VaultPath,
  options: { message?: string } = {},
): Promise<OperationResult> {
  if (refuseStandard(path)) return INVALID;
  if (samePath(parentFolder(path), parent)) return { ok: true, path };
  if (isInsideFolder(parent, path)) {
    showToast({ message: i18n.t('operations.errors.moveIntoItself'), tone: 'error' });
    return INVALID;
  }
  const name = baseName(path);
  return relocateFolder(path, joinPath(parent, name), {
    title: i18n.t('operations.confirm.folderMoveTitle', { name, folder: folderLabel(parent) }),
    confirmLabel: i18n.t('operations.confirm.moveConfirm'),
    done:
      options.message ?? i18n.t('operations.folderMoved', { name, folder: folderLabel(parent) }),
  });
}

/** "Chuyển vào Archive" for a whole folder: a move into `4 Archive` with relink. */
export function archiveFolder(path: VaultPath): Promise<OperationResult> {
  const message = i18n.t('operations.folderArchived', { name: baseName(path) });
  return moveFolder(path, ARCHIVE_FOLDER, { message });
}

/**
 * Moves a folder and every file below it to the trash (one entry, undo through the journal).
 * Asks first when it holds notes, since many notes leave at once.
 */
export async function trashFolder(
  path: VaultPath,
  options: { noteCount?: number } = {},
): Promise<OperationResult> {
  if (refuseStandard(path)) return INVALID;
  const name = baseName(path);
  const count = options.noteCount ?? 0;
  if (count > 0) {
    const confirmed = await confirmDialog({
      title: i18n.t('operations.confirm.folderTrashTitle', { name }),
      body: i18n.t('operations.confirm.folderTrashBody', { count }),
      confirmLabel: i18n.t('operations.confirm.folderTrashConfirm'),
      cancelLabel: i18n.t('operations.confirm.cancel'),
      danger: true,
    });
    if (!confirmed) return CANCELLED;
  }
  try {
    expectTabRemoval([], path);
    const result = await postFolderTrash(path);
    useTabsStore.getState().closeFolder(path);
    useTreeStore.getState().scheduleRefresh();
    showJournalUndoToast(i18n.t('operations.folderTrashed', { name }), result.journalId);
    return { ok: true, path };
  } catch (error) {
    showOperationError(error, 'folder');
    return FAILED;
  }
}
