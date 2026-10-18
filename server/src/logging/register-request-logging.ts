import type { FastifyInstance } from 'fastify';
import type { AppLogger } from './rotating-file-logger.js';

/**
 * One line per request: method, path WITHOUT the query string (it can carry the WS token),
 * status and duration. Never headers, bodies or note content.
 */
export function registerRequestLogging(app: FastifyInstance, logger: AppLogger): void {
  app.addHook('onResponse', async (request, reply) => {
    const path = request.url.split('?')[0];
    logger.info(`${request.method} ${path} ${reply.statusCode} ${reply.elapsedTime.toFixed(1)}ms`);
  });
}
