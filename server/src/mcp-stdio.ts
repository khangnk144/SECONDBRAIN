#!/usr/bin/env node
/**
 * Second Brain MCP entry for Claude Desktop's `claude_desktop_config.json` (SPEC F32):
 *   node <app>/server/dist/mcp-stdio.js [--home <dir>]
 * Home: `--home`, else SB_HOME, else the parent of the app folder (same rule as the server).
 * A thin bridge to the running server's `/mcp`; it starts the server when it is not running.
 * Exit codes: 0 = Claude closed the connection, 1 = the server could not be reached, 64 = bad
 * arguments. Diagnostics go to stderr as codes; stdout carries protocol messages only.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { resolveAppPaths } from './config/app-paths.js';
import { runMcpBridge } from './mcp/mcp-bridge.js';

/** This file is `<app>/server/src/mcp-stdio.ts` (tsx) or `<app>/server/dist/mcp-stdio.js`. */
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function main(): Promise<number> {
  let home: string | undefined;
  try {
    const { values } = parseArgs({
      args: process.argv.slice(2),
      options: { home: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    });
    home = values.home ?? (process.env.SB_HOME || undefined);
  } catch {
    process.stderr.write('second-brain-mcp: USAGE node mcp-stdio.js [--home <dir>]\n');
    return 64;
  }
  const paths = resolveAppPaths(home, appDir);
  try {
    const bridge = await runMcpBridge({
      home: paths.homeDir,
      appDir,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    });
    await bridge.closed;
    return 0;
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    process.stderr.write(
      `second-brain-mcp: FAILED ${typeof code === 'string' ? code : 'SERVER_UNREACHABLE'}\n`,
    );
    return 1;
  }
}

main().then((code) => process.exit(code));
