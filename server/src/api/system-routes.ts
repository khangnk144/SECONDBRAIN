import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { registerSystemInfoRoutes } from '../system/system-info-route.js';
import { revealCommand, spawnDetached, type RevealOptions } from './reveal-command.js';

/** The vault logger's file (see the vault handover logger). */
const APP_LOG_NAME = 'app.log';

/**
 * "Mở thư mục log" (SPEC F18): opens `<vault>/.secondbrain/logs` in the file manager (with the
 * current log selected where the OS can). This dedicated internal route is the only way to that
 * folder; note and file routes keep refusing `.secondbrain/`. Nothing is read or returned.
 */
export function registerSystemRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: RevealOptions = {},
): void {
  const onError =
    options.onError ??
    ((code: string) => context.logger.warn(`Could not open the file manager (${code}).`));
  const spawn = options.spawn ?? spawnDetached(onError);
  const platform = options.platform ?? process.platform;

  app.post('/api/logs/reveal', async (_request, reply) => {
    const logsDir = context.vault.paths.logsDir;
    await mkdir(logsDir, { recursive: true });
    const logFile = path.join(logsDir, APP_LOG_NAME);
    const hasLog = await lstat(logFile).then(
      (stats) => stats.isFile(),
      () => false,
    );
    spawn(revealCommand(platform, hasLog ? logFile : logsDir));
    return reply.code(204).send();
  });

  // F29: how the app runs, the tray helper, "Tạo lại lối tắt" (`GET /api/system`).
  registerSystemInfoRoutes(app, { platform: options.platform });
}
