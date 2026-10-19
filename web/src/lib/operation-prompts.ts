/** Menu entries that first ask for a target: "Di chuyển tới…", "Thư mục mới". */
import { i18n } from '../i18n';
import type { VaultPath } from './api/vault-types';
import { pickFolderDialog, promptDialog } from './dialogs/dialog-requests';
import { createFolder, moveFolder } from './folder-operations';
import { cleanName, validateName } from './name-validation';
import { moveNote } from './note-operations';
import { nameProblemMessage } from './operation-errors';
import { CANCELLED, type OperationResult } from './operation-result';
import { baseName, isInsideFolder, noteTitleFromPath, parentFolder, samePath } from './vault-paths';

export async function promptMoveNote(path: VaultPath): Promise<OperationResult> {
  const current = parentFolder(path);
  const folder = await pickFolderDialog({
    title: i18n.t('operations.pickFolder.moveNoteTitle', { title: noteTitleFromPath(path) }),
    confirmLabel: i18n.t('operations.pickFolder.confirm'),
    cancelLabel: i18n.t('operations.confirm.cancel'),
    isDisabled: (candidate) => samePath(candidate, current),
    includeRoot: true,
  });
  return folder === null ? CANCELLED : moveNote(path, folder);
}

export async function promptMoveFolder(path: VaultPath): Promise<OperationResult> {
  const current = parentFolder(path);
  const parent = await pickFolderDialog({
    title: i18n.t('operations.pickFolder.moveFolderTitle', { name: baseName(path) }),
    confirmLabel: i18n.t('operations.pickFolder.confirm'),
    cancelLabel: i18n.t('operations.confirm.cancel'),
    // Not where it already is, and never into itself or its own subfolders.
    isDisabled: (candidate) => samePath(candidate, current) || isInsideFolder(candidate, path),
    includeRoot: true,
  });
  return parent === null ? CANCELLED : moveFolder(path, parent);
}

export async function promptNewFolder(parent: VaultPath): Promise<OperationResult> {
  const name = await promptDialog({
    title: i18n.t('operations.newFolder.title', {
      parent: parent === '' ? i18n.t('operations.rootFolder') : parent,
    }),
    label: i18n.t('operations.newFolder.label'),
    confirmLabel: i18n.t('operations.newFolder.confirm'),
    cancelLabel: i18n.t('operations.confirm.cancel'),
    validate: (value) => {
      const problem = validateName(cleanName(value));
      return problem === null ? null : nameProblemMessage(problem);
    },
  });
  return name === null ? CANCELLED : createFolder(parent, name);
}
