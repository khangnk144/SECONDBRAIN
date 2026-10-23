import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import {
  BACKUP_SCHEDULE_PLUGIN,
  type BackupScheduleService,
} from '../backup/schedule/schedule-types.js';
import { ApiError } from '../http/api-errors.js';
import { revealCommand, spawnDetached, type RevealOptions } from './reveal-command.js';

const unavailable = () =>
  new ApiError(503, 'UNAVAILABLE', 'Scheduled backups are not running for this vault.');

/**
 * "Sao lưu tự động" (SPEC F27.1–F27.5): status, "Sao lưu ngay", "Mở thư mục" (only the
 * configured backup folder, never another one) and "Đẩy ngay". The plugin is looked up per
 * request (it belongs to the vault open right now). Outcomes of a run or push that went wrong
 * outside the app (disk full, GitHub refused) are answered 200 with `ok: false` and a code; a
 * folder that can never be used (inside the vault) is a 400 `VALIDATION` refusal.
 */
export function registerBackupScheduleRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: RevealOptions = {},
): void {
  const service = () => context.plugin<BackupScheduleService>(BACKUP_SCHEDULE_PLUGIN);
  const onError =
    options.onError ??
    ((code: string) => context.logger.warn(`Could not open the file manager (${code}).`));
  const spawn = options.spawn ?? spawnDetached(onError);
  const platform = options.platform ?? process.platform;

  app.get('/api/backup/schedule', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    const schedule = service();
    if (!schedule) return { available: false };
    return schedule.status();
  });

  app.post('/api/backup/schedule/run', async () => {
    const schedule = service();
    if (!schedule) throw unavailable();
    const { folderProblem } = await schedule.status();
    if (folderProblem) {
      throw new ApiError(
        400,
        'VALIDATION',
        'Choose a backup folder outside the vault and the app.',
        {
          field: 'backup.schedule.folder',
          reason: folderProblem,
        },
      );
    }
    return schedule.runNow();
  });

  app.post('/api/backup/schedule/open-folder', async (_request, reply) => {
    const schedule = service();
    if (!schedule) throw unavailable();
    const target = await schedule.folderToReveal();
    if (!target) {
      throw new ApiError(404, 'NOT_FOUND', 'The backup folder cannot be opened.', {
        reason: 'folder-missing',
      });
    }
    // The newest backup selected where the OS can; otherwise the folder itself.
    spawn(revealCommand(platform, target.newest ?? target.folder));
    return reply.code(204).send();
  });

  app.post('/api/backup/github/push', async () => {
    const schedule = service();
    if (!schedule) throw unavailable();
    return schedule.pushNow();
  });
}
