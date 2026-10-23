/**
 * Start mode of `index.ts` (default, `--login`). Source mode behaves as before (no browser; the
 * launcher opens the app). Exe mode (F29.1): a running server of this home is only opened; a
 * started one opens the app once it listens (not with `--login`); problems are shown in a message
 * box because the Windows build has no console; the first start creates the shortcuts (F29.4).
 * Every mode on Windows runs the tray helper while Settings allows it (F29.2).
 */
import type { VaultPlugin } from '../app-context/vault-plugins.js';
import { resolveAppPaths } from '../config/app-paths.js';
import { CliUsageError, parseCliOptions } from '../config/cli-args.js';
import { startServer } from '../runtime/start-server.js';
import { createRunAtLoginService } from './run-at-login.js';
import type { ExeFlags } from './exe-cli.js';
import { EXE_MESSAGES, readExeLanguage, startupLogOf } from './exe-messages.js';
import { showProblem } from './exe-problem.js';
import { createInstallShortcuts, ensureInstallShortcuts } from './install-shortcuts.js';
import { openAppWindow } from './open-app-window.js';
import { findOwnServer } from './own-server.js';
import { runtimeInfo, type RuntimeInfo } from './runtime-info.js';
import { provideSystemStatus } from './system-info-route.js';
import { createTrayHelper, type TrayHelperOptions } from './tray-helper.js';

export const EXIT_OK = 0;
export const EXIT_PORT_BUSY = 2;
export const EXIT_VAULT_UNUSABLE = 3;

export interface ServerModeInput {
  /** Server flags only (`--dev`, `--home`, `--port`). */
  argv: string[];
  flags: ExeFlags;
  plugins: VaultPlugin[];
  runtime?: RuntimeInfo;
  platform?: NodeJS.Platform;
  /** Opens `http://localhost:<port>/` in the default browser (tests record it). */
  openApp?: (port: number) => void;
  problem?: (text: string) => void;
  tray?: TrayHelperOptions;
  /** Tests: a fake app folder (web/dist) and a clean environment. */
  appDir?: string;
  env?: NodeJS.ProcessEnv;
}

/** Its own window: the installed app, else Edge/Chrome in app mode, else the browser. */
export function defaultOpenApp(port: number, platform: NodeJS.Platform = process.platform): void {
  openAppWindow(port, { platform });
}

export async function runServerMode(input: ServerModeInput): Promise<number> {
  const runtime = input.runtime ?? runtimeInfo();
  const platform = input.platform ?? process.platform;
  const exe = runtime.runtime === 'exe';
  const cli = parseCliOptions(input.argv, input.env);
  // The executable carries the built UI only (no Vite).
  if (exe && cli.dev) throw new CliUsageError('--dev is not available in the executable.');
  const home = resolveAppPaths(cli.home, input.appDir).homeDir;
  const text = () => EXE_MESSAGES[readExeLanguage(home)];
  const problem = input.problem ?? ((message: string) => showProblem(message, { platform }));
  const open = (port: number) => {
    if (exe && !input.flags.login) (input.openApp ?? defaultOpenApp)(port);
  };

  if (exe) {
    const own = await findOwnServer({ home, portOverride: cli.portOverride });
    if (own.kind === 'ours') {
      console.log(`Second Brain is already running at http://localhost:${own.port}`);
      open(own.port);
      return EXIT_OK;
    }
    if (own.kind === 'other') {
      if (!input.flags.login) problem(text().otherInstance(own.port));
      return EXIT_PORT_BUSY;
    }
  }

  const tray = createTrayHelper({ platform, ...input.tray });
  const result = await startServer({
    argv: input.argv,
    env: input.env,
    appDir: input.appDir,
    echoLogs: cli.dev,
    plugins: [...input.plugins, tray.plugin],
  });
  if (result.kind === 'already-running') {
    console.log(`Second Brain is already running at http://localhost:${result.port}`);
    open(result.port);
    return EXIT_OK;
  }
  if (result.kind === 'port-busy') {
    console.error(
      `Port ${result.port} is already used by another program. ` +
        `Close that program or choose another port (--port <n> or "port" in .secondbrain/settings.json).`,
    );
    if (exe) problem(text().portBusy(result.port));
    return EXIT_PORT_BUSY;
  }
  if (result.kind === 'vault-unusable') {
    console.error(result.message);
    console.error(
      'Choose another vault folder ("vaultPath" in .secondbrain/settings.json) or fix its permissions.',
    );
    if (exe) problem(text().vaultUnusable(startupLogOf(home)));
    return EXIT_VAULT_UNUSABLE;
  }

  console.log(`Second Brain is running at http://localhost:${result.port}`);
  const { logger, paths } = result;
  tray.start({ port: result.port, appDir: paths.appDir });
  const exePath = exe && platform === 'win32' ? runtime.exePath : null;
  const shortcuts = exePath
    ? {
        home: paths.homeDir,
        exePath,
        runAtLogin: createRunAtLoginService({ appDir: paths.appDir, exePath }),
      }
    : null;
  const unregister = provideSystemStatus({
    tray: () => tray.status(),
    recreateShortcuts: shortcuts ? () => createInstallShortcuts(shortcuts) : undefined,
  });
  if (shortcuts) {
    void ensureInstallShortcuts(shortcuts).then(
      (outcome) =>
        outcome === 'created' && logger.info('Created the Desktop and Start-menu shortcuts.'),
      (error: unknown) =>
        logger.warn(
          `Could not create the shortcuts (${(error as { code?: string }).code ?? 'error'}).`,
        ),
    );
  }
  open(result.port);

  await new Promise<void>((resolve) => {
    let stopping = false;
    const signals = ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const;
    const shutdown = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      logger.info(`Received ${signal}, shutting down.`);
      unregister();
      for (const name of signals) process.off(name, onSignal);
      tray
        .stop()
        .then(() => result.stop())
        .finally(resolve);
    };
    const onSignal = (signal: NodeJS.Signals) => shutdown(signal);
    for (const name of signals) process.on(name, onSignal);
    void result.shutdownRequested.then(() => shutdown('POST /api/shutdown'));
  });
  return EXIT_OK;
}
