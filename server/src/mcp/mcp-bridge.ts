/**
 * The stdio MCP entry for Claude Desktop (SPEC F32.1, F32.5): a thin bridge that forwards every
 * message verbatim between stdio and the running server's `/mcp`, starting the server when it is
 * not running. It owns no vault, index, watcher or scheduler: exactly one process does.
 * stdout carries protocol messages only; diagnostics go to stderr as short codes.
 */
import type { Readable, Writable } from 'node:stream';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { resolveAppDir } from '../config/app-paths.js';
import {
  defaultStartServer,
  ensureServer,
  findRunningServer,
  readBridgeTarget,
  type BridgeTarget,
} from './bridge-server.js';

export interface McpBridgeOptions {
  /**
   * Install root: `<home>/.secondbrain/settings.json` holds the token and the configured port,
   * `server.json` the port of the live server (preferred when it answers).
   */
  home: string;
  /** App folder, for the default server start (default: the one this file belongs to). */
  appDir?: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  fetch?: typeof fetch;
  /** Starts the server when it is down (default: launcher on Windows, `node dist/index.js` elsewhere). */
  startServer?: () => void | Promise<void>;
  /** How long to wait for the started server (default 90 s). */
  startTimeoutMs?: number;
  pollMs?: number;
}

export interface McpBridge {
  /** Resolves when stdin ended and the bridge shut down. */
  closed: Promise<void>;
  close(): Promise<void>;
}

interface LooseMessage {
  id?: unknown;
  method?: unknown;
  result?: { protocolVersion?: unknown };
}

const statusOf = (error: unknown) => (error as { code?: unknown } | null)?.code;

export async function runMcpBridge(options: McpBridgeOptions): Promise<McpBridge> {
  const fetchImpl = options.fetch ?? fetch;
  const report = (code: string) => options.stderr.write(`second-brain-mcp: ${code}\n`);
  const ensure = () =>
    ensureServer({
      home: options.home,
      fetch: fetchImpl,
      startServer:
        options.startServer ?? defaultStartServer(options.home, options.appDir ?? resolveAppDir()),
      timeoutMs: options.startTimeoutMs ?? 90_000,
      pollMs: options.pollMs ?? 500,
      report,
    });

  // The server is stateless: it has no stream for GET (always 405). Answering that here saves a
  // request whose abort at shutdown could leave an unused connection the server waits for.
  const mcpFetch: typeof fetch = (input, init) =>
    (init?.method ?? 'GET').toUpperCase() === 'GET'
      ? Promise.resolve(new Response(null, { status: 405 }))
      : fetchImpl(input, init);

  let target: BridgeTarget = await ensure();
  const stdio = new StdioServerTransport(options.stdin, options.stdout);
  let protocolVersion: string | null = null;
  const initializeIds = new Set<unknown>();

  const connect = async (next: BridgeTarget) => {
    if (next.token === null) throw Object.assign(new Error('NO_TOKEN'), { code: 'NO_TOKEN' });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${next.port}/mcp`),
      {
        fetch: mcpFetch,
        requestInit: { headers: { authorization: `Bearer ${next.token}` } },
      },
    );
    transport.onmessage = (message) => {
      const loose = message as LooseMessage;
      if (initializeIds.delete(loose.id) && typeof loose.result?.protocolVersion === 'string') {
        protocolVersion = loose.result.protocolVersion;
        transport.setProtocolVersion(protocolVersion);
      }
      void stdio.send(message);
    };
    transport.onerror = (error) => report(`HTTP_ERROR ${String(statusOf(error) ?? error.name)}`);
    await transport.start();
    if (protocolVersion) transport.setProtocolVersion(protocolVersion);
    return transport;
  };
  let http = await connect(target);

  /** Re-reads the token after a 401, restarts the server after a network failure; once each. */
  const recover = async (error: unknown): Promise<boolean> => {
    const status = statusOf(error);
    if (status === 401) {
      const fresh =
        (await findRunningServer(options.home, fetchImpl)) ??
        (await readBridgeTarget(options.home));
      if (fresh.token === null || (fresh.token === target.token && fresh.port === target.port)) {
        return false;
      }
      target = fresh;
    } else if (status === undefined && error instanceof TypeError) {
      target = await ensure().catch(() => target);
    } else {
      return false;
    }
    await http.close().catch(() => undefined);
    http = await connect(target);
    return true;
  };

  const forward = async (message: JSONRPCMessage) => {
    const loose = message as LooseMessage;
    if (loose.method === 'initialize') initializeIds.add(loose.id);
    try {
      await http.send(message);
    } catch (error) {
      let failure = error;
      try {
        if (await recover(error)) return await http.send(message);
      } catch (retryError) {
        failure = retryError;
      }
      report(`FORWARD_FAILED ${String(statusOf(failure) ?? 'network')}`);
      if (loose.method !== undefined && loose.id !== undefined) {
        await stdio.send({
          jsonrpc: '2.0',
          id: loose.id as string | number,
          error: {
            code: -32000,
            message: 'Second Brain is not reachable; open the app and try again.',
          },
        });
      }
    }
  };
  stdio.onmessage = (message) => void forward(message);
  stdio.onerror = () => report('STDIO_ERROR');

  let finish!: () => void;
  const closed = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let closing = false;
  const close = async () => {
    if (closing) return closed;
    closing = true;
    await stdio.close().catch(() => undefined);
    await http.close().catch(() => undefined);
    finish();
    return closed;
  };
  options.stdin.once('end', () => void close());
  options.stdin.once('close', () => void close());
  await stdio.start();
  report('CONNECTED');
  return { closed, close };
}
