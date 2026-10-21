import { access } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { GlobalSettings } from '../config/global-settings.js';

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

/** The two connection snippets of Settings "Kết nối Claude (MCP)" (SPEC F18, F32.1). */
export async function mcpConfig(options: McpConfigOptions): Promise<McpConfig> {
  const bridge = bridgePath(options.appDir);
  const defaultHome = path.dirname(path.resolve(options.appDir));
  const home = options.homeDir ? path.resolve(options.homeDir) : defaultHome;
  const args = home === defaultHome ? [bridge] : [bridge, '--home', home];
  const stdio = { command: options.execPath ?? process.execPath, args };
  const url = `http://localhost:${options.port}/mcp`;
  const authorization = `Bearer ${options.settings().sessionToken}`;
  const bridgeBuilt = await access(bridge).then(
    () => true,
    () => false,
  );
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
