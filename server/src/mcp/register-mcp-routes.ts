import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { registerMcpConfigRoute, type McpConfigOptions } from '../api/mcp-config-route.js';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { AppContext } from '../app-context/create-app-context.js';
import { BASELINE_SECURITY_HEADERS } from '../security/security-headers.js';
import { connectMcpServer, createMcpServer } from './create-mcp-server.js';
import { sweepStaleRuns } from './ingest-sweep.js';
import { KeyedLock } from './keyed-lock.js';
import type { McpDeps } from './mcp-deps.js';

export type McpRouteOptions = McpConfigOptions;

const jsonRpcError = (code: number, message: string) =>
  JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null });

/**
 * Streamable HTTP MCP at `/mcp` (SPEC F32, §5) in stateless mode: every POST gets a fresh
 * `McpServer` and transport bound to the vault open now; GET (server-sent stream) and DELETE
 * (session end) have no meaning without sessions and answer 405. Host, Origin (on every method)
 * and the bearer token are checked by the root security hook before this runs; the vault-switch
 * gate holds MCP requests like `/api` ones. Also registers `GET /api/mcp/config`.
 */
export function registerMcpRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: McpRouteOptions,
): void {
  const deps: McpDeps = { context, settings: options.settings, locks: new KeyedLock() };
  // Abandoned ingest runs are failed once per vault, before its first MCP call is served.
  const sweeps = new Map<string, Promise<void>>();
  const sweepOnce = () => {
    const vaultId = context.vault.id;
    let sweep = sweeps.get(vaultId);
    if (!sweep) {
      sweep = sweepStaleRuns(deps).catch((error: unknown) =>
        context.logger.warn(`MCP: stale ingest runs not swept (${errorCodeOf(error)}).`),
      );
      sweeps.set(vaultId, sweep);
    }
    return sweep;
  };

  registerMcpConfigRoute(app, options);

  app.post('/mcp', async (request, reply) => {
    await sweepOnce();
    const server = createMcpServer(deps);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await connectMcpServer(server, transport, deps);
    // The reply is written by the transport, so Fastify's onSend headers are set here.
    for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      reply.raw.setHeader(name, value);
    }
    reply.raw.setHeader('cache-control', 'no-store');
    reply.raw.once('close', () => {
      void transport.close();
      void server.close();
    });
    reply.hijack();
    try {
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      context.logger.error(`MCP request failed (${errorCodeOf(error)}).`);
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'content-type': 'application/json' });
        reply.raw.end(jsonRpcError(-32603, 'Internal server error.'));
      }
    }
    return reply;
  });

  const notAllowed = async (_request: unknown, reply: FastifyReply) =>
    reply
      .code(405)
      .header('allow', 'POST')
      .header('cache-control', 'no-store')
      .type('application/json; charset=utf-8')
      .send(jsonRpcError(-32000, 'Method not allowed.'));
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}
