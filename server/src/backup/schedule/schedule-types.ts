/**
 * Scheduled backups (SPEC F27): what one run records in `<home>/.secondbrain/backups.json` and
 * what `GET /api/backup/schedule` answers. Errors are short codes (the UI words them); never a
 * path, a token or a git/SMTP message.
 */
import type { VaultPluginInstance } from '../../app-context/vault-plugins.js';

export type BackupRunKind = 'scheduled' | 'catch-up' | 'retry' | 'manual';

/** Why a run failed (`Lỗi: …` in Settings). */
export type BackupFailure =
  | 'folder-missing'
  | 'not-a-folder'
  | 'not-writable'
  | 'disk-full'
  | 'inside-vault'
  | 'inside-app'
  | 'too-large'
  | 'failed';

export interface BackupRun {
  /** Start of the run, ISO instant. */
  at: string;
  kind: BackupRunKind;
  /** Absolute path of the zip written; null when the run failed. */
  file: string | null;
  bytes: number;
  ok: boolean;
  error?: BackupFailure;
  /** The zip is gone (retention removed it, or it disappeared or is no longer ours). */
  removed?: boolean;
}

/** Why a push to GitHub failed (F27.5). */
export type PushFailure =
  | 'auth'
  | 'network'
  | 'rejected'
  | 'no-git'
  | 'no-history'
  | 'not-configured'
  | 'busy'
  /** The app closed (vault switch, "Thoát") while git was pushing: git was stopped. */
  | 'interrupted'
  | 'failed';

export interface PushRecord {
  at: string;
  ok: boolean;
  error?: PushFailure;
}

/** One vault's entry in `backups.json`. */
export interface VaultBackupRecord {
  /** Newest last; at most `MAX_RUNS` (zips still on disk are never dropped from the list). */
  runs: BackupRun[];
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  /** A failed run is retried at this instant (1 h later); null when nothing failed since. */
  retryAt: string | null;
  push: PushRecord | null;
}

export interface BackupRunView {
  at: string;
  kind: BackupRunKind;
  /** File name only (the folder is in the status). */
  fileName: string | null;
  bytes: number;
  ok: boolean;
  error?: BackupFailure;
}

/** Folder settings that make a run impossible, found before it starts. */
export type FolderProblem = 'inside-vault' | 'inside-app' | 'not-absolute';

export interface BackupScheduleStatus {
  available: true;
  enabled: boolean;
  time: string;
  keep: number;
  /** The folder the zips go to (the configured one or `<home>/Backups`). */
  folder: string;
  isDefaultFolder: boolean;
  folderProblem: FolderProblem | null;
  running: boolean;
  nextRunAt: string | null;
  lastSuccessAt: string | null;
  retryAt: string | null;
  lastRun: BackupRunView | null;
  lastSuccess: BackupRunView | null;
  /** Newest first, at most 10. */
  runs: BackupRunView[];
  github: {
    enabled: boolean;
    /** Remote URL and token are both set. */
    configured: boolean;
    /** `ok`, or why pushing is impossible on this machine/vault. */
    git: 'ok' | 'missing' | 'no-history';
    pushing: boolean;
    lastPush: PushRecord | null;
  };
}

export type ManualRunResult =
  | { ok: true; run: BackupRunView }
  | { ok: false; run: BackupRunView | null; error: BackupFailure | 'busy' };

/** The running plugin of the open vault (`context.plugin(BACKUP_SCHEDULE_PLUGIN)`). */
export interface BackupScheduleService extends VaultPluginInstance {
  status(): Promise<BackupScheduleStatus>;
  /** "Sao lưu ngay". */
  runNow(): Promise<ManualRunResult>;
  /** "Đẩy ngay". */
  pushNow(): Promise<PushRecord>;
  /** The folder "Mở thư mục" opens (created when it is the default one), and the newest zip in it. */
  folderToReveal(): Promise<{ folder: string; newest: string | null } | null>;
  /** One scheduler check now (also what every timer tick does). */
  check(): Promise<void>;
}

export const BACKUP_SCHEDULE_PLUGIN = 'backup-schedule';
