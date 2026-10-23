/**
 * Scheduled backups and the GitHub push (SPEC F27), mirrored from
 * `server/src/backup/schedule/schedule-types.ts` and `server/src/api/backup-schedule-routes.ts`.
 */
import { api } from '../api';

export type BackupRunKind = 'scheduled' | 'catch-up' | 'retry' | 'manual';

export type BackupFailure =
  | 'folder-missing'
  | 'not-a-folder'
  | 'not-writable'
  | 'disk-full'
  | 'inside-vault'
  | 'inside-app'
  | 'too-large'
  | 'failed';

export type PushFailure =
  | 'auth'
  | 'network'
  | 'rejected'
  | 'no-git'
  | 'no-history'
  | 'not-configured'
  | 'busy'
  | 'interrupted'
  | 'failed';

export interface BackupRunView {
  at: string;
  kind: BackupRunKind;
  fileName: string | null;
  bytes: number;
  ok: boolean;
  error?: BackupFailure;
}

export interface PushRecord {
  at: string;
  ok: boolean;
  error?: PushFailure;
}

export interface BackupScheduleStatus {
  available: true;
  enabled: boolean;
  time: string;
  keep: number;
  folder: string;
  isDefaultFolder: boolean;
  folderProblem: 'inside-vault' | 'inside-app' | 'not-absolute' | null;
  running: boolean;
  nextRunAt: string | null;
  lastSuccessAt: string | null;
  retryAt: string | null;
  lastRun: BackupRunView | null;
  lastSuccess: BackupRunView | null;
  runs: BackupRunView[];
  github: {
    enabled: boolean;
    configured: boolean;
    git: 'ok' | 'missing' | 'no-history';
    pushing: boolean;
    lastPush: PushRecord | null;
  };
}

export type BackupScheduleAnswer = BackupScheduleStatus | { available: false };

export type ManualRunResult =
  | { ok: true; run: BackupRunView }
  | { ok: false; run: BackupRunView | null; error: BackupFailure | 'busy' };

export const getBackupSchedule = () => api().get<BackupScheduleAnswer>('/backup/schedule');

/** "Sao lưu ngay"; a folder inside the vault answers 400 `VALIDATION` (`details.reason`). */
export const runBackupNow = () =>
  api().request<ManualRunResult>('/backup/schedule/run', { method: 'POST' });

/** "Mở thư mục": the configured backup folder only. */
export const openBackupFolder = () =>
  api().request<void>('/backup/schedule/open-folder', { method: 'POST' });

/** "Đẩy ngay". */
export const pushToGithubNow = () =>
  api().request<PushRecord>('/backup/github/push', { method: 'POST' });
