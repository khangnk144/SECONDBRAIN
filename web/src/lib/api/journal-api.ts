/** Crash recovery and undo of multi-file operations (SPEC §4.12). Ids are ULIDs, never paths. */
import { api } from '../api';
import type { PendingJournalResponse } from './journal-types';

export function getPendingJournal(): Promise<PendingJournalResponse> {
  return api().get<PendingJournalResponse>('/journal/pending');
}

/** Revision-checked; 409 CONFLICT with `details.conflicts` when a touched file changed since. */
export function postJournalUndo(id: string): Promise<{ ok: true }> {
  return api().request<{ ok: true }>(`/journal/${encodeURIComponent(id)}/undo`, {
    method: 'POST',
  });
}

export function postJournalComplete(id: string): Promise<{ ok: true }> {
  return api().request<{ ok: true }>(`/journal/${encodeURIComponent(id)}/complete`, {
    method: 'POST',
  });
}
