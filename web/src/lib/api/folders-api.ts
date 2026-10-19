/** Folder endpoints: create, rename/move (journaled, with relink) and trash. */
import { api } from '../api';
import type { RelinkDryRun, RelinkResult, TrashResult } from './notes-types';
import type { VaultPath } from './vault-types';

export interface FolderRenameRequest {
  path: VaultPath;
  /** Also used to move a folder under another parent. */
  newPath: VaultPath;
  relink?: boolean;
}

export function postFolder(path: VaultPath): Promise<{ path: VaultPath }> {
  return api().request<{ path: VaultPath }>('/folder', { method: 'POST', body: { path } });
}

export function postFolderRename(body: FolderRenameRequest): Promise<RelinkResult> {
  return api().request<RelinkResult>('/folder/rename', { method: 'POST', body });
}

export function postFolderRenameDryRun(body: FolderRenameRequest): Promise<RelinkDryRun> {
  return api().request<RelinkDryRun>('/folder/rename', {
    method: 'POST',
    body: { ...body, dryRun: true },
  });
}

/** Every file below the folder goes into one trash entry (undo through the journal). */
export function postFolderTrash(path: VaultPath): Promise<TrashResult> {
  return api().request<TrashResult>('/folder/trash', { method: 'POST', body: { path } });
}
