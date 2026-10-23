import { CliUsageError } from '../config/cli-args.js';

/**
 * The modes of the executable (F29.1), also accepted from source (`tsx src/index.ts --stop`):
 *   (none)        start, or only open the app when this home's server already runs
 *   --login       start silently at sign-in: no browser, nothing shown when already running
 *   --stop        graceful stop through POST /api/shutdown; exit 0 = stopped or not running
 *   --mcp-stdio   the stdio MCP bridge for Claude Desktop (SPEC F32)
 * They are taken out of argv before the server's own flags (`--home`, `--port`, `--dev`) are
 * parsed, so `parseCliOptions` keeps its strict rules.
 */
export interface ExeFlags {
  login: boolean;
  stop: boolean;
  mcpStdio: boolean;
}

const FLAGS: Record<string, keyof ExeFlags> = {
  '--login': 'login',
  '--stop': 'stop',
  '--mcp-stdio': 'mcpStdio',
};

export const EXE_USAGE =
  'Usage: second-brain [--login | --stop | --mcp-stdio] [--home <dir>] [--port <n>]';

export function splitExeFlags(argv: readonly string[]): { flags: ExeFlags; rest: string[] } {
  const flags: ExeFlags = { login: false, stop: false, mcpStdio: false };
  const rest: string[] = [];
  for (const arg of argv) {
    const key = FLAGS[arg];
    if (key) flags[key] = true;
    else rest.push(arg);
  }
  if ([flags.login, flags.stop, flags.mcpStdio].filter(Boolean).length > 1) {
    throw new CliUsageError('Use only one of --login, --stop and --mcp-stdio.');
  }
  return { flags, rest };
}
