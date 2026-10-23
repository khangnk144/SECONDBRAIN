/**
 * `--mcp-stdio` (F29.1, SPEC F32): the stdio MCP bridge of `mcp-stdio.ts`, reached through the
 * executable's single entry. When the server is down the bridge starts it; in exe mode that is
 * the executable itself (`defaultStartServer`). Same exit codes and stderr codes as mcp-stdio.ts;
 * stdout carries protocol messages only. Imports nothing of the vault stack (tested).
 */
import { resolveAppDir } from '../config/app-paths.js';
import { runMcpBridge } from '../mcp/mcp-bridge.js';

export interface McpStdioModeOptions {
  home: string;
  appDir?: string;
}

export async function runMcpStdioMode(options: McpStdioModeOptions): Promise<number> {
  try {
    const bridge = await runMcpBridge({
      home: options.home,
      appDir: options.appDir ?? resolveAppDir(),
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
