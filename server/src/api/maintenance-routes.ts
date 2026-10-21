import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { VaultError } from '../vault/vault-types.js';

/** Index rebuild ("Xây lại chỉ mục") and the opt-in sample data of SPEC §10. */
export function registerMaintenanceRoutes(app: FastifyInstance, context: AppContext): void {
  // 202: the rebuild runs in the background, progress arrives as `index:progress` WS events,
  // and searches keep being answered by the old index until the swap.
  app.post('/api/index/rebuild', async (_request, reply) => {
    if (!context.startRebuild()) {
      throw new VaultError('CONFLICT', 'An index rebuild is already running.');
    }
    return reply.code(202).send({ started: true });
  });

  app.get('/api/sample-data', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return context.sampleData.status();
  });

  app.post('/api/sample-data', async (_request, reply) => {
    const result = await context.sampleData.create();
    await context.settled();
    return reply.code(201).send(result);
  });

  app.delete('/api/sample-data', async () => {
    const result = await context.sampleData.remove();
    await context.settled();
    await context.refreshPendingJournal();
    return result;
  });
}
