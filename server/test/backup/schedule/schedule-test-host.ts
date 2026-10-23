/**
 * The backup-schedule plugin on a real vault test app: manual timers (a test "ticks" after
 * moving the mocked clock), a memory logger and helpers to read the folder and the records.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import {
  createBackupSchedulePlugin,
  type BackupSchedulePluginOptions,
} from '../../../src/backup/schedule/backup-schedule-plugin.js';
import {
  BACKUP_SCHEDULE_PLUGIN,
  type BackupScheduleService,
} from '../../../src/backup/schedule/schedule-types.js';
import type { AppLogger } from '../../../src/logging/rotating-file-logger.js';
import { createMemoryLogger, type VaultTestApp } from '../../api/vault-test-app.js';
import { manualTimers, type ManualTimers } from '../../reminders/helpers/reminder-test-host.js';

export interface StartedSchedule {
  service: BackupScheduleService;
  timers: ManualTimers;
  logger: AppLogger & { lines: string[] };
}

/** Starts the plugin the way the vault host does and attaches it to the context. */
export async function startSchedule(
  t: VaultTestApp,
  options: BackupSchedulePluginOptions = {},
): Promise<StartedSchedule> {
  const timers = manualTimers();
  const logger = createMemoryLogger();
  const service = await createBackupSchedulePlugin({ timers, ...options }).start({
    context: t.context,
    settings: () => t.settings,
    port: t.port,
    logger,
    globalStateDir: path.join(t.home, '.secondbrain'),
  });
  t.context.attachPlugin(BACKUP_SCHEDULE_PLUGIN, service);
  // The start check runs in the background: let it finish before the test moves on.
  await service.check();
  await waitIdle(service);
  return { service, timers, logger };
}

/** One timer beat after the clock moved, waited for. */
export async function tick(started: StartedSchedule): Promise<void> {
  started.timers.tick();
  await started.service.check();
  await waitIdle(started.service);
}

/** Resolves once no backup or push runs. */
export async function waitIdle(service: BackupScheduleService): Promise<void> {
  for (let i = 0; i < 400; i += 1) {
    const status = await service.status();
    if (!status.running && !status.github.pushing) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('the backup schedule stayed busy');
}

export const backupsFolder = (t: VaultTestApp) => path.join(t.home, 'Backups');

export function zipsIn(folder: string): string[] {
  return existsSync(folder)
    ? readdirSync(folder)
        .filter((n) => n.endsWith('.zip'))
        .sort()
    : [];
}

export function recordsOf(t: VaultTestApp): {
  vaults: Record<
    string,
    {
      runs: { ok: boolean; error?: string; kind: string; removed?: boolean }[];
      lastSuccessAt: string | null;
      retryAt: string | null;
    }
  >;
} {
  return JSON.parse(readFileSync(path.join(t.home, '.secondbrain', 'backups.json'), 'utf8'));
}

/** Entry names of a zip file. */
export function zipEntries(file: string): string[] {
  return Object.keys(unzipSync(new Uint8Array(readFileSync(file)))).sort();
}

/** Local time; months are 1-based here. */
export const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi);
