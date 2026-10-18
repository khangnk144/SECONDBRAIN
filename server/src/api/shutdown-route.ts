import type { FastifyInstance } from 'fastify';

/**
 * POST /api/shutdown – graceful stop for the launcher ("Mở Second Brain.cmd stop") and, later,
 * the "Thoát Second Brain" button. Protected like every /api route (token, Origin, Host).
 * The reply is flushed first; the server then closes, removes server.json and exits.
 * Any request body or content type is accepted and ignored (PowerShell may send an empty
 * form-encoded body).
 */
export async function registerShutdownRoute(
  app: FastifyInstance,
  requestShutdown: () => void,
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_request, _payload, done) => done(null, undefined));
    scope.post('/api/shutdown', async (_request, reply) => {
      reply.raw.once('finish', () => setImmediate(requestShutdown));
      return reply.code(202).header('cache-control', 'no-store').send({ ok: true });
    });
  });
}
