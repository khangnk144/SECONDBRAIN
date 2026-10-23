/**
 * `GET /api/backup/schedule` (SPEC F27.4): what Settings shows under "Sao lưu tự động" – the
 * folder, the next run, the last runs (file names only) and the GitHub push state. Built from
 * the settings, `backups.json` and the clock; nothing is created or changed.
 */
import path from 'node:path';
import type { BackupSettings } from '../../config/settings-sections-m5.js';
import { folderProblem, targetFolderOf } from './backup-target-folder.js';
import { nextBackupAt } from './backup-timing.js';
import type {
  BackupRun,
  BackupRunView,
  BackupScheduleStatus,
  VaultBackupRecord,
} from './schedule-types.js';

export const STATUS_RUNS = 10;

export function runView(run: BackupRun): BackupRunView {
  return {
    at: run.at,
    kind: run.kind,
    fileName: run.file ? path.basename(run.file) : null,
    bytes: run.bytes,
    ok: run.ok,
    ...(run.error ? { error: run.error } : {}),
  };
}

export interface StatusInput {
  backup: BackupSettings;
  record: VaultBackupRecord;
  home: string;
  vaultRoot: string;
  protectedDirs: readonly string[];
  now: Date;
  running: boolean;
  pushing: boolean;
  configured: boolean;
  git: BackupScheduleStatus['github']['git'];
}

export async function buildScheduleStatus(input: StatusInput): Promise<BackupScheduleStatus> {
  const { schedule, github } = input.backup;
  const { record } = input;
  const target = targetFolderOf(schedule.folder, input.home);
  const newestFirst = [...record.runs].reverse();
  const lastSuccess = newestFirst.find((run) => run.ok) ?? null;
  return {
    available: true,
    enabled: schedule.enabled,
    time: schedule.time,
    keep: schedule.keep,
    folder: target.folder,
    isDefaultFolder: target.isDefault,
    folderProblem: await folderProblem(schedule.folder, input.vaultRoot, input.protectedDirs),
    running: input.running,
    nextRunAt: schedule.enabled
      ? nextBackupAt({ now: input.now, time: schedule.time, ...record }).toISOString()
      : null,
    lastSuccessAt: record.lastSuccessAt,
    retryAt: schedule.enabled ? record.retryAt : null,
    lastRun: newestFirst[0] ? runView(newestFirst[0]) : null,
    lastSuccess: lastSuccess ? runView(lastSuccess) : null,
    runs: newestFirst.slice(0, STATUS_RUNS).map(runView),
    github: {
      enabled: github.enabled,
      configured: input.configured,
      git: input.git,
      pushing: input.pushing,
      lastPush: record.push,
    },
  };
}
