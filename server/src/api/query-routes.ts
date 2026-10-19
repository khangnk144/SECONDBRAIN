import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import type { SearchQuery } from '../index/index-types.js';
import { toLocalDate } from '../lib/local-date.js';

interface SearchQuerystring {
  q?: string;
  tag?: string;
  folder?: string;
  type?: string;
  due?: '7d' | '30d' | 'overdue';
  class?: 'archive';
  limit?: number;
}

const shortText = { type: 'string', maxLength: 500 } as const;
const includeArchiveQuery = {
  type: 'object',
  properties: { includeArchive: { type: 'boolean', default: false } },
} as const;

const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

/**
 * Read-only views over the index and the deadline-items service. Today, Calendar and Tasks
 * all come from the same service (SPEC §4.7), which derives "today" from the clock on every call.
 */
export function registerQueryRoutes(app: FastifyInstance, context: AppContext): void {
  const { index, deadlines } = context;

  app.get<{ Querystring: SearchQuerystring }>(
    '/api/search',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            q: { type: 'string', maxLength: 1000 },
            tag: shortText,
            folder: shortText,
            type: shortText,
            due: { type: 'string', enum: ['7d', '30d', 'overdue'] },
            class: { type: 'string', enum: ['archive'] },
            limit: { type: 'integer', minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const { q = '', ...filters } = request.query;
      const query: SearchQuery = { q, ...filters };
      noStore(reply);
      return { results: index.search(query) };
    },
  );

  app.get('/api/tags', async (_request, reply) => {
    noStore(reply);
    return { tags: index.tags() };
  });

  app.get('/api/today', async (_request, reply) => {
    noStore(reply);
    return deadlines.today();
  });

  app.get<{ Querystring: { month?: string; includeArchive: boolean } }>(
    '/api/calendar',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            month: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$' },
            includeArchive: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request, reply) => {
      const month = request.query.month ?? toLocalDate(context.now()).slice(0, 7);
      noStore(reply);
      return deadlines.calendar(month, { includeArchive: request.query.includeArchive });
    },
  );

  app.get<{ Querystring: { includeArchive: boolean } }>(
    '/api/tasks',
    { schema: { querystring: includeArchiveQuery } },
    async (request, reply) => {
      noStore(reply);
      return deadlines.tasks({ includeArchive: request.query.includeArchive });
    },
  );
}
