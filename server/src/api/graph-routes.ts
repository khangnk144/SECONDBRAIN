import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import {
  graphFilterQuerySchema,
  parseGraphFilterQuery,
  type GraphFilterQuery,
} from '../graph/graph-filter-query.js';
import { replayEventLog } from '../graph/graph-history-log.js';
import { exactCreationTimes } from '../graph/graph-history-state.js';
import { withMatches, withNodeFacts } from '../graph/graph-node-facts.js';
import { cachedGraphBody } from '../graph/graph-response-cache.js';
import { buildGraph, localGraph } from '../graph/vault-graph.js';
import { guardVaultPath } from '../security/path-guard.js';
import { notFound } from '../vault/vault-errors.js';
import { registerGraphHistoryRoutes } from './graph-history-routes.js';
import { vaultPathSchema } from './vault-route-schemas.js';

/**
 * The brain graph (SPEC F16, F24) from the index: `GET /graph` the whole vault with each note's
 * filter facts (mtime, tags, creation) and, when `folder`/`group`/`tag`/`since` are given, the
 * ids that match (`matches`; the map dims the rest, so nothing is removed); `GET /graph/local`
 * the neighbourhood of one note (depth 1 or 2) for the note's right pane (the whole-vault body is
 * kept while the index and the event log stay the same, `graph-response-cache.ts`); `GET /graph/history`
 * for the time scrubber. A note that exists but is not drawn (a template, a control doc, an
 * unlinked raw source) has an empty local graph; an unknown path is 404.
 */
export function registerGraphRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: GraphFilterQuery }>(
    '/api/graph',
    { schema: { querystring: graphFilterQuerySchema } },
    async (request, reply) => {
      const filter = parseGraphFilterQuery(request.query);
      const events = await context.activity.events();
      const { body, json } = cachedGraphBody(context.index, events, () =>
        withNodeFacts(
          buildGraph(context.index.graphRows()),
          context.index,
          exactCreationTimes(replayEventLog(events)),
        ),
      );
      reply.header('cache-control', 'no-store');
      if (filter !== null) return withMatches(body, filter);
      reply.type('application/json; charset=utf-8');
      return reply.send(json());
    },
  );

  app.get<{ Querystring: { path: string; depth: 1 | 2 } }>(
    '/api/graph/local',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path'],
          properties: {
            path: vaultPathSchema,
            depth: { type: 'integer', enum: [1, 2], default: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const path = guardVaultPath(request.query.path);
      const graph = buildGraph(context.index.graphRows());
      const drawn = graph.nodes.some((n) => n.id === path);
      if (!drawn && context.index.getNote(path) === null) throw notFound(path);
      reply.header('cache-control', 'no-store');
      return localGraph(graph, path, request.query.depth);
    },
  );

  registerGraphHistoryRoutes(app, context);
}
