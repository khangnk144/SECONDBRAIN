/** Version history routes (`/api/history*`), mirrored from `server/src/git/history-types.ts`. */
import type { VaultPath } from './vault-types';

/** Why history is off: git is not installed, the repository could not be prepared, … */
export type HistoryUnavailableReason =
  'git-missing' | 'init-failed' | 'not-started' | 'closed' | 'git-failed';

export interface HistoryStatus {
  available: boolean;
  reason?: HistoryUnavailableReason;
  /** ISO 8601, null before the first commit. */
  lastCommitAt: string | null;
}

export interface HistoryCommit {
  commit: string;
  shortCommit: string;
  /** Committer date, ISO 8601 with offset. */
  date: string;
  /** Subject line: `auto: 3 files`, `restore: <path> @ <short>`, or a commit made outside. */
  message: string;
  /** Made by the automatic commit (every 10 minutes and on close). */
  auto: boolean;
  /** The note's path in that commit (it may have been renamed since). */
  pathAtCommit: VaultPath;
}

export interface NoteHistoryResponse {
  available: boolean;
  /** Newest first, at most 200. */
  commits: HistoryCommit[];
}

export interface NoteVersionResponse {
  content: string;
  pathAtCommit: VaultPath;
}

export interface RestoreVersionRequest {
  path: VaultPath;
  commit: string;
  expectedRevision: string;
}

export interface RestoreVersionResponse {
  revision: string;
  /** The commit made right after the restore; null when it could not be made. */
  commit: string | null;
}
