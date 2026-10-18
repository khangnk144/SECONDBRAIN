import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendApiError } from '../http/api-errors.js';
import {
  canonicalOrigin,
  decodedRequestPath,
  isAllowedHost,
  isAllowedOrigin,
  isApiPath,
  isLoopbackIpHost,
  isPublicApiRoute,
  isStateChangingMethod,
  isWebSocketPath,
  isWebSocketUpgrade,
} from './host-and-origin-rules.js';
import { BASELINE_SECURITY_HEADERS } from './security-headers.js';
import { tokensMatch } from './session-token.js';

export interface SecurityHookOptions {
  port: number;
  /** Returns the current session token (read on every request so a rotated token applies at once). */
  getToken: () => string;
}

export const TOKEN_HEADER = 'x-sb-token';

function headerValue(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function queryToken(url: string): string | null {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;
  return new URLSearchParams(url.slice(queryIndex + 1)).get('token');
}

/**
 * Adds the network-boundary checks as the first root-level onRequest hook, so they run for
 * every request including WebSocket upgrades (which @fastify/websocket routes through Fastify):
 *   1. Host allowlist          → 421
 *   2. Origin on writes and WS → 403
 *   3. Session token           → 401 (header for /api, `?token=` for /ws)
 *   4. 127.0.0.1 shell GET     → 302 to the canonical origin
 */
export function registerSecurityHooks(app: FastifyInstance, options: SecurityHookOptions): void {
  const { port } = options;

  app.addHook('onRequest', async (request, reply) => {
    // Only origin-form targets ("/path?query"). An absolute-form target
    // ("GET http://localhost:4747/api/settings") would otherwise be routed by Fastify while
    // the path checks below see a string that is neither an API nor a WebSocket path.
    if (!request.url.startsWith('/')) {
      return sendApiError(reply, 400, 'VALIDATION', 'The request target must be a path.');
    }

    const host = headerValue(request, 'host');
    if (!isAllowedHost(host, port)) {
      return sendApiError(
        reply,
        421,
        'MISDIRECTED_REQUEST',
        'This server only answers on localhost.',
      );
    }

    const upgrade = isWebSocketUpgrade(request.headers);
    if (isStateChangingMethod(request.method) || upgrade) {
      if (!isAllowedOrigin(headerValue(request, 'origin'), port)) {
        return sendApiError(
          reply,
          403,
          'FORBIDDEN',
          'Requests from other origins are not allowed.',
        );
      }
    }

    const path = decodedRequestPath(request.url);
    // API calls are never redirected: the launcher probes /api/health on 127.0.0.1 because
    // `localhost` may resolve to ::1 first on Windows while the server binds 127.0.0.1 only.
    if (isApiPath(path)) {
      const needsToken = !isPublicApiRoute(request.method, path);
      if (needsToken && !tokensMatch(options.getToken(), headerValue(request, TOKEN_HEADER))) {
        return sendApiError(reply, 401, 'UNAUTHORIZED', 'Missing or invalid session token.');
      }
      return;
    }

    if (isWebSocketPath(path)) {
      if (!tokensMatch(options.getToken(), queryToken(request.url))) {
        return sendApiError(reply, 401, 'UNAUTHORIZED', 'Missing or invalid session token.');
      }
      return;
    }

    const isRead = request.method === 'GET' || request.method === 'HEAD';
    if (isRead && !upgrade && isLoopbackIpHost(host, port)) {
      return reply.redirect(`${canonicalOrigin(port)}${request.url}`, 302);
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(BASELINE_SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    // CORS is never opened: strip anything a plugin might have added.
    reply.removeHeader('access-control-allow-origin');
    reply.removeHeader('access-control-allow-credentials');
    return payload;
  });
}
