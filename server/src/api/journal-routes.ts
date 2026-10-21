import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { journalIdParams } from './vault-route-schemas.js';

/**
 * Crash recovery and undo of multi-file operations (SPEC §4.12): the UI lists unfinished
 * entries ("Một thao tác chưa hoàn tất") and offers "Hoàn tất" / "Hoàn tác"; the undo toast
 * calls undo within its 10 s window. Journal ids are ULIDs, never paths.
 */
export function registerJournalRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/journal/pending', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return { entries: await context.vault.pendingJournal() };
  });

  for (const action of ['undo', 'complete'] as const) {
    app.post<{ Params: { id: string } }>(
      `/api/journal/:id/${action}`,
      { schema: { params: journalIdParams } },
      async (request) => {
        try {
          if (action === 'undo') await context.vault.undoJournal(request.params.id);
          else await context.vault.completeJournal(request.params.id);
        } finally {
          await context.settled();
          await context.refreshPendingJournal();
        }
        return { ok: true };
      },
    );
  }
}
