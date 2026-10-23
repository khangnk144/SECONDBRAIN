/**
 * One scheduled (or "Sao lưu ngay") backup of the open vault (SPEC F27): lock → check the folder
 * → build the same zip as "Xuất bản sao lưu…" (state + trash, no cache, never settings or
 * secrets) → place it atomically in the folder → record it → retention. A failure is recorded
 * with a plain code and a retry 1 h later; the log gets codes and counts, never paths or names.
 */
import path from 'node:path';
import { errorCodeOf } from '../../app-context/app-context-errors.js';
import type { AppContext } from '../../app-context/create-app-context.js';
import type { BackupScheduleSettings } from '../../config/settings-sections-m5.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import { buildBackupFile, sendableBackup } from '../backup-export-file.js';
import type { BackupRecords } from './backup-records.js';
import { applyRetention } from './backup-retention.js';
import { acquireBackupLock } from './backup-run-lock.js';
import { failureOf, prepareTargetFolder, targetFolderOf } from './backup-target-folder.js';
import { retryAfter } from './backup-timing.js';
import { placeBackupZip, type PlaceZipHooks } from './place-backup-zip.js';
import { scheduledBackupName } from './scheduled-backup-name.js';
import { removeStaleBackupTemps } from './stale-backup-temps.js';
import type { BackupRun, BackupRunKind } from './schedule-types.js';

export interface BackupRunDeps {
  context: AppContext;
  records: BackupRecords;
  /** `<home>/.secondbrain` (lock file). */
  globalStateDir: string;
  home: string;
  /** App and global-state folders a backup folder must not be inside. */
  protectedDirs: readonly string[];
  now: () => Date;
  logger: AppLogger;
  schedule: () => BackupScheduleSettings;
  placeHooks?: PlaceZipHooks;
}

/** `recorded: false`: `backups.json` could not be written (the plugin still remembers the run). */
export type BackupRunOutcome = { busy: true } | { busy: false; run: BackupRun; recorded: boolean };

async function writeZip(deps: BackupRunDeps, at: Date): Promise<{ file: string; bytes: number }> {
  const { context } = deps;
  const vault = context.vault; // one vault for the whole run, even if a switch follows
  const target = targetFolderOf(deps.schedule().folder, deps.home);
  const folder = await prepareTargetFolder(target, vault.root, deps.protectedDirs);
  // Under the lock: temp files of a run that crashed hours ago (never a live one) go first.
  const stale = await removeStaleBackupTemps(folder, deps.now());
  if (stale > 0) deps.logger.info(`Removed ${stale} unfinished backup temp files.`);
  await context.settled(); // the zip matches what the index has seen
  const built = await buildBackupFile(vault);
  const vaultName = path.basename(vault.root);
  return placeBackupZip(
    sendableBackup(built),
    folder,
    (n) => scheduledBackupName(vaultName, at, n),
    deps.placeHooks,
  );
}

async function keepNewest(deps: BackupRunDeps, vaultId: string): Promise<number> {
  const { folder } = targetFolderOf(deps.schedule().folder, deps.home);
  const record = await deps.records.read(vaultId);
  const result = await applyRetention(record.runs, folder, deps.schedule().keep);
  if (result.deleted.length === 0 && result.forgotten.length === 0) return 0;
  const settled = new Set([...result.deleted, ...result.forgotten]);
  await deps.records.update(vaultId, (draft) => {
    for (const run of draft.runs) if (run.file && settled.has(run.file)) run.removed = true;
  });
  return result.deleted.length;
}

export async function runScheduledBackup(
  deps: BackupRunDeps,
  kind: BackupRunKind,
): Promise<BackupRunOutcome> {
  const release = await acquireBackupLock(deps.globalStateDir, deps.now);
  if (!release) return { busy: true };
  const vaultId = deps.context.vault.id;
  const started = deps.now();
  const at = started.toISOString();
  try {
    let run: BackupRun;
    try {
      const { file, bytes } = await writeZip(deps, started);
      run = { at, kind, file, bytes, ok: true };
    } catch (error) {
      const failure = failureOf(error);
      run = { at, kind, file: null, bytes: 0, ok: false, error: failure };
      deps.logger.warn(
        `Scheduled backup failed (${failure}, ${errorCodeOf(error)}); trying again in 1 hour.`,
      );
    }
    const recorded = await deps.records
      .update(vaultId, (record) => {
        record.runs.push(run);
        record.lastAttemptAt = at;
        record.lastSuccessAt = run.ok ? at : record.lastSuccessAt;
        record.retryAt = run.ok ? null : retryAfter(started);
      })
      .then(
        () => true,
        (error: unknown) => {
          deps.logger.warn(`Recording the backup failed (${errorCodeOf(error)}).`);
          return false;
        },
      );
    if (run.ok && recorded) {
      const deleted = await keepNewest(deps, vaultId).catch((error: unknown) => {
        deps.logger.warn(`Backup retention failed (${errorCodeOf(error)}).`);
        return 0;
      });
      deps.logger.info(
        `Scheduled backup written (${kind}, ${run.bytes} bytes; ${deleted} older removed).`,
      );
    }
    return { busy: false, run, recorded };
  } finally {
    await release();
  }
}
