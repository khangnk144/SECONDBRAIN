import type { FastifyInstance } from 'fastify';
import { resolveAppPaths, type AppPaths } from '../config/app-paths.js';
import { parseCliOptions, resolvePort } from '../config/cli-args.js';
import { loadOrCreateGlobalSettings } from '../config/global-settings.js';
import { buildApp } from '../http/build-app.js';
import { createFileLogger, type AppLogger } from '../logging/rotating-file-logger.js';
import { SERVER_VERSION } from '../version.js';
import { probeExistingServer } from './probe-existing-server.js';
import { removeServerInfoIfOwned, writeServerInfo } from './server-info-file.js';

export const LISTEN_HOST = '127.0.0.1';

export type StartResult =
  | {
      kind: 'started';
      app: FastifyInstance;
      port: number;
      paths: AppPaths;
      logger: AppLogger;
      stop: () => Promise<void>;
      /** Resolves when POST /api/shutdown was accepted; the caller then runs stop(). */
      shutdownRequested: Promise<void>;
    }
  | { kind: 'already-running'; port: number }
  | { kind: 'port-busy'; port: number };

export interface StartServerInput {
  argv: string[];
  env?: NodeJS.ProcessEnv;
  /** Override the app directory (tests point it at a fixture with a fake web/dist). */
  appDir?: string;
  echoLogs?: boolean;
}

/**
 * Boot sequence: CLI/env → global settings → logger → app → listen on 127.0.0.1 → server.json.
 * Returns instead of exiting so it can be tested; index.ts maps results to exit codes.
 */
export async function startServer(input: StartServerInput): Promise<StartResult> {
  const cli = parseCliOptions(input.argv, input.env ?? process.env);
  const paths = resolveAppPaths(cli.home, input.appDir);
  const { settings, created, corruptBackup } = await loadOrCreateGlobalSettings(paths.settingsFile);
  const logger = createFileLogger({
    dir: paths.logsDir,
    secrets: () => [settings.sessionToken],
    echo: input.echoLogs,
  });
  if (created) logger.info('Created global settings with a new session token.');
  if (corruptBackup)
    logger.warn(
      `Settings file was unreadable; kept a copy at ${corruptBackup} and wrote defaults.`,
    );

  const port = resolvePort(cli, settings.port);
  const mode = cli.dev ? 'development' : 'production';
  // Cheap pre-check so a second launch never spins up Vite or touches server.json.
  if (await probeExistingServer(port)) {
    logger.info(
      `Another Second Brain server already answers on port ${port}; not starting a second one.`,
    );
    return { kind: 'already-running', port };
  }
  let resolveShutdownRequest: () => void = () => {};
  const shutdownRequested = new Promise<void>((resolve) => {
    resolveShutdownRequest = resolve;
  });
  const app = await buildApp({
    getSettings: () => settings,
    port,
    mode,
    webDir: paths.webDir,
    webDistDir: paths.webDistDir,
    logger,
    version: SERVER_VERSION,
    requestShutdown: () => {
      logger.info('Shutdown requested through the API.');
      resolveShutdownRequest();
    },
  });

  try {
    await app.listen({ host: LISTEN_HOST, port });
  } catch (error) {
    await app.close();
    if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    if (await probeExistingServer(port)) {
      logger.info(
        `Another Second Brain server already answers on port ${port}; not starting a second one.`,
      );
      return { kind: 'already-running', port };
    }
    logger.error(`Port ${port} is used by another program.`);
    return { kind: 'port-busy', port };
  }

  await writeServerInfo(paths.serverInfoFile, {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
    version: SERVER_VERSION,
  });
  logger.info(`Listening on http://localhost:${port} (${mode}).`);

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    await app.close();
    await removeServerInfoIfOwned(paths.serverInfoFile, process.pid);
    logger.info('Server stopped.');
  };
  return { kind: 'started', app, port, paths, logger, stop, shutdownRequested };
}
