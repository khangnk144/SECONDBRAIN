/**
 * Version history of a note (SPEC F20). Without git the listing answers `available: false` and
 * the other calls 503 `UNAVAILABLE` (`details.reason`).
 */
import { api } from '../api';
import type {
  HistoryStatus,
  NoteHistoryResponse,
  NoteVersionResponse,
  RestoreVersionRequest,
  RestoreVersionResponse,
} from './history-types';
import { withQuery } from './query-string';
import type { VaultPath } from './vault-types';

export function getHistoryStatus(): Promise<HistoryStatus> {
  return api().get<HistoryStatus>('/history/status');
}

export function getNoteHistory(path: VaultPath): Promise<NoteHistoryResponse> {
  return api().get<NoteHistoryResponse>(withQuery('/history', { path }));
}

/** The note's text at `commit`; 404 when it did not exist there. */
export function getNoteVersion(path: VaultPath, commit: string): Promise<NoteVersionResponse> {
  return api().get<NoteVersionResponse>(withQuery('/history/version', { path, commit }));
}

/** Writes that version over the note (409 `CONFLICT` when it changed since `expectedRevision`). */
export function restoreNoteVersion(body: RestoreVersionRequest): Promise<RestoreVersionResponse> {
  return api().request<RestoreVersionResponse>('/history/restore', { method: 'POST', body });
}
