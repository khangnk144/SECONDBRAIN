import { access } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { GlobalSettings } from '../config/global-settings.js';
import { runtimeInfo, type RuntimeInfo } from '../system/runtime-info.js';

export interface McpConfigOptions {
  /** Current settings (the session token is the bearer token of the HTTP transport). */
  settings: () => GlobalSettings;
  port: number;
  /** The app folder (`<home>/app`): the bridge is `<app>/server/dist/mcp-stdio.js`. */
  appDir: string;
  /** Install root; passed to the bridge only when it is not the app folder's parent. */
  homeDir?: string;
  /** Node binary Claude Desktop should run (default: the one running this server). */
  execPath?: string;
  /** Exe or source (default: from the environment, F29.4). */
  runtime?: RuntimeInfo;
}

export interface McpConfig {
  stdio: { command: string; args: string[] };
  /** `claude_desktop_config.json` text (2-space JSON). */
  stdioSnippet: string;
  http: { url: string };
  httpSnippet: string;
  /** The bridge file exists (a fresh checkout has no build yet). */
  bridgeBuilt: boolean;
}

export const MCP_SERVER_KEY = 'second-brain';

export function bridgePath(appDir: string): string {
  return path.join(path.resolve(appDir), 'server', 'dist', 'mcp-stdio.js');
}

/** `{ command, args }` for Claude Desktop; the executable runs the bridge with `--mcp-stdio`. */
async function stdioCommand(options: McpConfigOptions) {
  const { exePath } = options.runtime ?? runtimeInfo();
  if (exePath) {
    // The executable's home is its own folder unless the server was started with another one.
    const exeHome = path.dirname(exePath);
    const home = options.homeDir ? path.resolve(options.homeDir) : exeHome;
    const args = home === exeHome ? ['--mcp-stdio'] : ['--mcp-stdio', '--home', home];
    return { stdio: { command: exePath, args }, bridgeBuilt: true };
  }
  const bridge = bridgePath(options.appDir);
  const defaultHome = path.dirname(path.resolve(options.appDir));
  const home = options.homeDir ? path.resolve(options.homeDir) : defaultHome;
  const args = home === defaultHome ? [bridge] : [bridge, '--home', home];
  const bridgeBuilt = await access(bridge).then(
    () => true,
    () => false,
  );
  return { stdio: { command: options.execPath ?? process.execPath, args }, bridgeBuilt };
}

/** The two connection snippets of Settings "Kết nối Claude (MCP)" (SPEC F18, F32.1). */
export async function mcpConfig(options: McpConfigOptions): Promise<McpConfig> {
  const { stdio, bridgeBuilt } = await stdioCommand(options);
  const url = `http://localhost:${options.port}/mcp`;
  const authorization = `Bearer ${options.settings().sessionToken}`;
  return {
    stdio,
    stdioSnippet: JSON.stringify({ mcpServers: { [MCP_SERVER_KEY]: stdio } }, null, 2),
    http: { url },
    httpSnippet: JSON.stringify(
      {
        mcpServers: {
          [MCP_SERVER_KEY]: { type: 'http', url, headers: { Authorization: authorization } },
        },
      },
      null,
      2,
    ),
    bridgeBuilt,
  };
}

/** `GET /api/mcp/config` (token, Origin and Host rules like every `/api` route). */
export function registerMcpConfigRoute(app: FastifyInstance, options: McpConfigOptions): void {
  app.get('/api/mcp/config', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return mcpConfig(options);
  });
}
