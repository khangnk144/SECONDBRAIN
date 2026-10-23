import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { cachedHistoryJson } from '../graph/graph-history-cache.js';
import { replayEventLog } from '../graph/graph-history-log.js';
import { buildGraphHistory } from '../graph/graph-history.js';
import { buildGraph } from '../graph/vault-graph.js';

/**
 * `GET /api/graph/history` (SPEC F24.1): when each node and edge of the brain map existed, for
 * the time scrubber. Derived from `state/events.jsonl` (the vault's one shared, cached reader and
 * its shared, incremental replay) and checked against the live index; the built answer is kept
 * while the log, the live graph and the week stay the same (`graph-history-cache.ts`).
 * Read-only like every GET.
 */
export function registerGraphHistoryRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/graph/history', async (_request, reply) => {
    const state = replayEventLog(await context.activity.events());
    const rows = context.index.graphRows();
    const now = context.now();
    const json = cachedHistoryJson(context.activity, state, rows, now, () =>
      buildGraphHistory(
        state,
        {
          graph: buildGraph(rows),
          links: rows.links,
          notes: new Set(rows.notes.map((note) => note.path)),
          files: new Set(rows.files),
        },
        now,
      ),
    );
    reply.header('cache-control', 'no-store');
    reply.type('application/json; charset=utf-8');
    return reply.send(json);
  });
}
