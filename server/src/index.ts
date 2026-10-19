#!/usr/bin/env node
/**
 * Second Brain server entry point.
 *   node server/dist/index.js [--dev] [--home <dir>] [--port <n>]
 * Exit codes: 0 = stopped normally or another Second Brain server is already running,
 *             1 = unexpected error, 2 = the port is used by another program,
 *             3 = the vault folder cannot be used, 64 = bad arguments.
 * Startup failures are also written to <home>/.secondbrain/logs/server.log, which the launcher
 * shows when the server does not come up.
 */
import { CliUsageError } from './config/cli-args.js';
import { startServer } from './runtime/start-server.js';

const EXIT_OK = 0;
const EXIT_FAILURE = 1;
const EXIT_PORT_BUSY = 2;
const EXIT_VAULT_UNUSABLE = 3;
const EXIT_USAGE = 64;

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const result = await startServer({ argv, echoLogs: argv.includes('--dev') });

  if (result.kind === 'already-running') {
    console.log(`Second Brain is already running at http://localhost:${result.port}`);
    return EXIT_OK;
  }
  if (result.kind === 'port-busy') {
    console.error(
      `Port ${result.port} is already used by another program. ` +
        `Close that program or choose another port (--port <n> or "port" in .secondbrain/settings.json).`,
    );
    return EXIT_PORT_BUSY;
  }
  if (result.kind === 'vault-unusable') {
    console.error(result.message);
    console.error(
      'Choose another vault folder ("vaultPath" in .secondbrain/settings.json) or fix its permissions.',
    );
    return EXIT_VAULT_UNUSABLE;
  }

  console.log(`Second Brain is running at http://localhost:${result.port}`);
  await new Promise<void>((resolve) => {
    let stopping = false;
    const shutdown = (signal: string): void => {
      if (stopping) return;
      stopping = true;
      result.logger.info(`Received ${signal}, shutting down.`);
      result.stop().finally(resolve);
    };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) {
      process.on(signal, () => shutdown(signal));
    }
    void result.shutdownRequested.then(() => shutdown('POST /api/shutdown'));
  });
  return EXIT_OK;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error('Usage: node server/dist/index.js [--dev] [--home <dir>] [--port <n>]');
      process.exit(EXIT_USAGE);
    }
    console.error(
      'Second Brain server failed to start:',
      error instanceof Error ? error.message : error,
    );
    process.exit(EXIT_FAILURE);
  });
