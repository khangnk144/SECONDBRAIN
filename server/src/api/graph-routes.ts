import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { buildGraph, localGraph } from '../graph/vault-graph.js';
import { guardVaultPath } from '../security/path-guard.js';
import { notFound } from '../vault/vault-errors.js';
import { vaultPathSchema } from './vault-route-schemas.js';

/**
 * The brain graph (SPEC F16 Phase 1) from the index: `GET /graph` the whole vault, `GET
 * /graph/local` the neighbourhood of one note (depth 1 or 2) for the note's right pane. The
 * folder/tag/time filters are Phase 2. A note that exists but is not drawn (a template, a control
 * doc, an unlinked raw source) has an empty local graph; an unknown path is 404.
 */
export function registerGraphRoutes(app: FastifyInstance, context: AppContext): void {
  const { index } = context;

  app.get('/api/graph', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return buildGraph(index.graphRows());
  });

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
      const graph = buildGraph(index.graphRows());
      const drawn = graph.nodes.some((n) => n.id === path);
      if (!drawn && index.getNote(path) === null) throw notFound(path);
      reply.header('cache-control', 'no-store');
      return localGraph(graph, path, request.query.depth);
    },
  );
}
