#!/usr/bin/env node
/**
 * Second Brain server entry point, also the single executable's entry (F29.1).
 *   node server/dist/index.js [--dev] [--home <dir>] [--port <n>]
 *   node server/dist/index.js --login | --stop | --mcp-stdio   (see system/exe-cli.ts)
 * Exit codes: 0 = stopped normally or another Second Brain server is already running,
 *             1 = unexpected error, 2 = the port is used by another program,
 *             3 = the vault folder cannot be used, 64 = bad arguments.
 * Startup failures are also written to <home>/.secondbrain/logs/server.log, which the launcher
 * shows when the server does not come up.
 * Heavy modules load lazily: `--stop` and `--mcp-stdio` never load the vault stack.
 */
import type { VaultPlugin } from './app-context/vault-plugins.js';
import { resolveAppPaths } from './config/app-paths.js';
import { CliUsageError, parseCliOptions } from './config/cli-args.js';
import { EXE_USAGE, splitExeFlags } from './system/exe-cli.js';
import { runtimeInfo } from './system/runtime-info.js';

const EXIT_FAILURE = 1;
const EXIT_USAGE = 64;

/** Per-vault background services: they start with each opened vault and stop before it closes. */
async function vaultPlugins(): Promise<VaultPlugin[]> {
  const [sources, reminders, history, ai, backupSchedule] = await Promise.all([
    import('./sources/sources-plugin.js'),
    import('./reminders/reminders-plugin.js'),
    import('./git/history-plugin.js'),
    import('./ai/ai-plugin.js'),
    import('./backup/schedule/backup-schedule-plugin.js'),
  ]);
  const semester = await import('./semester/semester-page-plugin.js');
  return [
    sources.createSourcesPlugin(),
    reminders.createRemindersPlugin(),
    history.createHistoryPlugin(),
    ai.createAiPlugin(),
    // M5 (F27): after history (it pushes the history repository); closes first.
    backupSchedule.createBackupSchedulePlugin(),
    // M5 (F25): the generated "Học kỳ này" page; off until she turns it on.
    semester.createSemesterPagePlugin(),
  ];
}

/** The install root once the arguments are known (for the exe's failure message). */
let knownHome: string | null = null;

async function main(): Promise<number> {
  const { flags, rest: argv } = splitExeFlags(process.argv.slice(2));
  const cli = parseCliOptions(argv);
  const home = resolveAppPaths(cli.home).homeDir;
  knownHome = home;
  if (flags.stop) {
    const { runStopMode } = await import('./system/stop-mode.js');
    return runStopMode({ home, portOverride: cli.portOverride });
  }
  if (flags.mcpStdio) {
    const { runMcpStdioMode } = await import('./system/mcp-stdio-mode.js');
    return runMcpStdioMode({ home });
  }
  const { runServerMode } = await import('./system/server-mode.js');
  return runServerMode({ argv, flags, plugins: await vaultPlugins() });
}

main()
  .then((code) => process.exit(code))
  .catch(async (error: unknown) => {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error('Usage: node server/dist/index.js [--dev] [--home <dir>] [--port <n>]');
      console.error(EXE_USAGE);
      process.exit(EXIT_USAGE);
    }
    console.error(
      'Second Brain server failed to start:',
      error instanceof Error ? error.message : error,
    );
    if (runtimeInfo().runtime === 'exe' && knownHome) {
      // No console in the Windows build: say it in a message box too.
      const { showProblem } = await import('./system/exe-problem.js');
      const { EXE_MESSAGES, readExeLanguage, startupLogOf } =
        await import('./system/exe-messages.js');
      showProblem(EXE_MESSAGES[readExeLanguage(knownHome)].failed(startupLogOf(knownHome)));
    }
    process.exit(EXIT_FAILURE);
  });
