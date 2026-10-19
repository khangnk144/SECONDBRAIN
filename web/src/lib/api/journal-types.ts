/** Operation journal (SPEC §4.12), mirrored from `server/src/vault/vault-types.ts`. */
import type { VaultPath } from './vault-types';

/** Known kinds; the server may add more (folder operations), so any string is accepted. */
export type JournalOp = 'rename' | 'move' | 'trash' | 'restore' | 'reschedule' | (string & {});

export type JournalStatus = 'planned' | 'running' | 'done' | 'failed' | 'undone' | 'undoing';

/** An operation that did not finish ("Một thao tác chưa hoàn tất"). */
export interface PendingJournalEntry {
  id: string;
  op: JournalOp;
  status: JournalStatus;
  createdAt: string;
  totalSteps: number;
  appliedSteps: number;
  paths: VaultPath[];
}

export interface PendingJournalResponse {
  entries: PendingJournalEntry[];
}
