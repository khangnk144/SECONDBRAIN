/** Contract of the history plugin (SPEC F20) as the routes see it. */
import type { VaultPluginInstance } from '../app-context/vault-plugins.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { HistoryCommit } from './note-history-log.js';

export type { HistoryCommit } from './note-history-log.js';

/** `not-started`: no history plugin runs for this vault (routes answer it when the lookup is null). */
export type HistoryUnavailableReason = 'git-missing' | 'init-failed' | 'not-started';

export interface HistoryStatus {
  available: boolean;
  reason?: HistoryUnavailableReason;
  /** Committer date of the newest commit (ISO 8601), null when there is none yet. */
  lastCommitAt: string | null;
}

export interface NoteVersion {
  /** The note's text at that commit (UTF-8, BOM and line endings as stored). */
  content: string;
  pathAtCommit: VaultPath;
}

export interface RestoreResult {
  revision: string;
  /** The commit made right after the restore; null when it could not be made (logged). */
  commit: string | null;
}

/** Thrown by a history service that cannot answer (git missing, init failed, closing). */
export class HistoryUnavailableError extends Error {
  constructor(readonly reason: HistoryUnavailableReason | 'closed') {
    super(`Version history is not available (${reason}).`);
    this.name = 'HistoryUnavailableError';
  }
}

export interface HistoryService extends VaultPluginInstance {
  status(): HistoryStatus;
  /** Commits touching the note, newest first, following renames (≤ 200). */
  noteHistory(path: VaultPath): Promise<HistoryCommit[]>;
  /** The note at `commit` (a full or abbreviated hash); null when it did not exist there. */
  noteVersion(path: VaultPath, commit: string): Promise<NoteVersion | null>;
  /** Writes that version over the note at `expectedRevision`, then commits at once. */
  restore(path: VaultPath, commit: string, expectedRevision: string): Promise<RestoreResult>;
  /** Auto-commit now (the timer and close use it); never throws, null when nothing changed. */
  commitNow(): Promise<{ commit: string; files: number } | null>;
  /** Resolves when no git command is queued or running. */
  idle(): Promise<void>;
}
