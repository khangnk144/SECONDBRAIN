import { i18n } from '../i18n';
import { isApiError } from './api-client';
import { postNote, postNoteTrash } from './api/notes-api';
import type { VaultPath } from './api/vault-types';
import { showOperationError } from './operation-errors';
import { acceptName, FAILED, INVALID, type OperationResult } from './operation-result';
import { expectTabRemoval, useTabsStore } from './tabs-store';
import { showToast } from './toast-store';
import { useTreeStore } from './tree-store';
import { showUndoConflict, showUndoToast } from './undo-toast';
import { INBOX_FOLDER, joinPath, noteTitleFromPath } from './vault-paths';

export interface CreateNoteOptions {
  /** Defaults to `0 Inbox`. */
  folder?: VaultPath;
  /** Path of a file in `Templates/`. */
  template?: VaultPath;
  /** Defaults to "Ghi chú mới" / "New note"; ` 2`, ` 3`, … is appended when the name is taken. */
  title?: string;
  newTab?: boolean;
}

/**
 * Creates a note (unique name), opens it with `&new=1` so the note screen selects the title, and
 * offers undo for 10 s (undo = trash it, refused when it was edited meanwhile).
 */
export async function createNote(options: CreateNoteOptions = {}): Promise<OperationResult> {
  const title = acceptName(options.title ?? i18n.t('operations.newNoteTitle'));
  if (title === null) return INVALID;
  const folder = options.folder ?? INBOX_FOLDER;
  try {
    const created = await postNote({
      path: joinPath(folder, `${title}.md`),
      unique: true,
      ...(options.template ? { template: options.template } : {}),
    });
    useTabsStore.getState().openNote(created.path, { newTab: options.newTab, isNew: true });
    useTreeStore.getState().scheduleRefresh();
    showUndoToast(
      i18n.t('operations.created', { title: noteTitleFromPath(created.path) }),
      async () => {
        await trashForUndo(created.path, created.revision);
      },
    );
    return { ok: true, path: created.path };
  } catch (error) {
    showOperationError(error);
    return FAILED;
  }
}

async function trashForUndo(path: VaultPath, revision: string): Promise<void> {
  try {
    expectTabRemoval([path]);
    await postNoteTrash([path], [revision]);
    useTabsStore.getState().closePaths([path]);
    useTreeStore.getState().scheduleRefresh();
    showToast({ message: i18n.t('operations.undone') });
  } catch (error) {
    if (isApiError(error, 'CONFLICT')) showUndoConflict([path]);
    else showOperationError(error);
  }
}
