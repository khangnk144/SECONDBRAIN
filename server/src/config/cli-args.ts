import { parseArgs } from 'node:util';

export const DEFAULT_PORT = 4747;

export interface CliOptions {
  dev: boolean;
  home?: string;
  /** Port given on the command line or via SB_PORT; undefined means "use settings". */
  portOverride?: number;
}

export class CliUsageError extends Error {}

export function parsePort(value: string | number | undefined, source: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new CliUsageError(`Invalid port from ${source}: ${String(value)}`);
  }
  return port;
}

/** Parses `[--dev] [--home <dir>] [--port <n>]`; env SB_HOME / SB_PORT are fallbacks. */
export function parseCliOptions(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: false,
      strict: true,
      options: {
        dev: { type: 'boolean', default: false },
        home: { type: 'string' },
        port: { type: 'string' },
      },
    });
  } catch (error) {
    throw new CliUsageError((error as Error).message);
  }
  const { values } = parsed;
  const home = values.home ?? (env.SB_HOME || undefined);
  const portOverride = parsePort(values.port, '--port') ?? parsePort(env.SB_PORT, 'SB_PORT');
  return { dev: values.dev ?? false, home, portOverride };
}

/** Port precedence: --port > SB_PORT > settings.port > 4747. */
export function resolvePort(options: CliOptions, settingsPort: unknown): number {
  if (options.portOverride !== undefined) return options.portOverride;
  try {
    return parsePort(settingsPort as number | undefined, 'settings.port') ?? DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}
