/**
 * The per-vault plugin `backup-schedule` (SPEC F27): checks every 60 s (and at start, which is
 * the catch-up after the machine was off) whether a backup is due, runs at most one at a time,
 * pushes the history to GitHub after each scheduled success when that is set up, and answers
 * the Settings routes. Closing (shutdown, vault switch) waits for a running backup, and stops a
 * running push (git is killed; the push is recorded as `interrupted`) rather than waiting for it.
 */
import path from 'node:path';
import { errorCodeOf } from '../../app-context/app-context-errors.js';
import type { VaultPlugin, VaultPluginHost } from '../../app-context/vault-plugins.js';
import { resolveAppDir } from '../../config/app-paths.js';
import { normalizeBackup } from '../../config/settings-sections-m5.js';
import { BACKUP_RECORDS_FILE, emptyRecord, openBackupRecords } from './backup-records.js';
import { buildScheduleStatus, runView } from './backup-schedule-status.js';
import { folderProblem, prepareTargetFolder, targetFolderOf } from './backup-target-folder.js';
import { dueBackupKind, timingAfter, type Timing } from './backup-timing.js';
import { newestBackupIn } from './newest-backup.js';
import { historyState, pushConfigured, pushToGithub, type PushOptions } from './github-push-job.js';
import type { PlaceZipHooks } from './place-backup-zip.js';
import { runScheduledBackup, type BackupRunDeps } from './run-scheduled-backup.js';
import {
  BACKUP_SCHEDULE_PLUGIN,
  type BackupRunKind,
  type BackupScheduleService,
  type ManualRunResult,
  type PushRecord,
} from './schedule-types.js';

export const CHECK_MS = 60_000;

export interface ScheduleTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface BackupSchedulePluginOptions extends PushOptions {
  now?: () => Date;
  timers?: ScheduleTimers;
  placeHooks?: PlaceZipHooks;
}

const nodeTimers: ScheduleTimers = {
  setInterval(callback, ms) {
    const handle = setInterval(callback, ms);
    handle.unref();
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

async function startSchedule(
  host: VaultPluginHost,
  options: BackupSchedulePluginOptions,
): Promise<BackupScheduleService> {
  const { context, logger } = host;
  if (!host.globalStateDir) throw new Error('The backup schedule needs the global state folder.');
  const globalStateDir = host.globalStateDir;
  const home = path.dirname(globalStateDir);
  const now = options.now ?? context.now;
  const protectedDirs = [globalStateDir, path.join(home, 'app'), resolveAppDir()];
  const records = openBackupRecords({
    file: path.join(globalStateDir, BACKUP_RECORDS_FILE),
    now,
    logger,
  });
  const backup = () => normalizeBackup(host.settings().backup);
  const deps: BackupRunDeps = {
    context,
    records,
    globalStateDir,
    home,
    protectedDirs,
    now,
    logger,
    schedule: () => backup().schedule,
    placeHooks: options.placeHooks,
  };
  const vaultId = context.vault.id;
  let closed = false;
  const closing = new AbortController();
  let running: Promise<unknown> | null = null;
  let pushing: Promise<PushRecord> | null = null;
  /** The timing of the last run when `backups.json` could not record it. */
  let unrecorded: Timing | null = null;

  const track = <T>(work: Promise<T>): Promise<T> => {
    running = work.finally(() => (running = null));
    return work;
  };

  function push(): Promise<PushRecord> {
    if (pushing) return Promise.resolve({ at: now().toISOString(), ok: false, error: 'busy' });
    pushing = (async () => {
      const result = await pushToGithub({
        ...options,
        context,
        github: () => host.settings().backup.github,
        now,
        logger,
        signal: closing.signal,
      });
      if (result.error !== 'busy' && result.error !== 'not-configured')
        await records
          .update(vaultId, (record) => (record.push = result))
          .catch((error: unknown) =>
            logger.warn(`Recording the push failed (${errorCodeOf(error)}).`),
          );
      return result;
    })().finally(() => (pushing = null));
    return pushing;
  }

  async function backupOnce(kind: BackupRunKind) {
    const outcome = await runScheduledBackup(deps, kind);
    if (!outcome.busy) unrecorded = outcome.recorded ? null : timingAfter(outcome.run);
    return outcome;
  }

  async function check(): Promise<void> {
    if (closed || running) return;
    const settings = backup();
    if (!settings.schedule.enabled) return;
    let timing: Timing;
    try {
      timing = unrecorded ?? (await records.read(vaultId));
    } catch (error) {
      logger.warn(`Backup records could not be read (${errorCodeOf(error)}); checking later.`);
      return;
    }
    const kind = dueBackupKind({ now: now(), time: settings.schedule.time, ...timing });
    if (!kind || closed || running) return;
    await track(
      (async () => {
        const outcome = await backupOnce(kind);
        // F27.5: after each scheduled success (a manual "Sao lưu ngay" does not push).
        const github = host.settings().backup.github;
        const pushWanted =
          backup().github.enabled && pushConfigured(github, options.allowFileRemote);
        if (!outcome.busy && outcome.run.ok && pushWanted && !closed) await push();
      })(),
    );
  }

  const safeCheck = () =>
    check().catch((error: unknown) =>
      logger.warn(`Backup check failed (${errorCodeOf(error)}); trying again later.`),
    );
  const timers = options.timers ?? nodeTimers;
  const handle = timers.setInterval(() => void safeCheck(), CHECK_MS);
  void safeCheck(); // catch-up after the machine or the server was off

  return {
    async status() {
      const base = await records.read(vaultId).catch(() => emptyRecord());
      return buildScheduleStatus({
        backup: backup(),
        record: unrecorded ? { ...base, ...unrecorded } : base,
        home,
        vaultRoot: context.vault.root,
        protectedDirs,
        now: now(),
        running: running !== null,
        pushing: pushing !== null,
        configured: pushConfigured(host.settings().backup.github, options.allowFileRemote),
        git: historyState(context),
      });
    },
    async runNow(): Promise<ManualRunResult> {
      if (closed || running) return { ok: false, run: null, error: 'busy' };
      const outcome = await track(backupOnce('manual'));
      if (outcome.busy) return { ok: false, run: null, error: 'busy' };
      const view = runView(outcome.run);
      return outcome.run.ok
        ? { ok: true, run: view }
        : { ok: false, run: view, error: outcome.run.error ?? 'failed' };
    },
    pushNow: () =>
      closed ? Promise.resolve({ at: now().toISOString(), ok: false, error: 'busy' }) : push(),
    async folderToReveal() {
      const target = targetFolderOf(backup().schedule.folder, home);
      if (await folderProblem(backup().schedule.folder, context.vault.root, protectedDirs))
        return null;
      try {
        await prepareTargetFolder(target, context.vault.root, protectedDirs);
      } catch {
        return null;
      }
      return { folder: target.folder, newest: await newestBackupIn(target.folder) };
    },
    check: safeCheck,
    async close() {
      if (closed) return;
      closed = true;
      timers.clearInterval(handle);
      closing.abort(); // a push in flight stops now (up to 3 min otherwise)
      await Promise.allSettled([running, pushing]);
    },
  };
}

export function createBackupSchedulePlugin(
  options: BackupSchedulePluginOptions = {},
): VaultPlugin<BackupScheduleService> {
  return { name: BACKUP_SCHEDULE_PLUGIN, start: (host) => startSchedule(host, options) };
}
