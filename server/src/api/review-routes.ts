import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { isCalendarDate } from '../lib/local-date.js';
import { buildWeekReview } from '../review/weekly-review.js';
import { VaultError } from '../vault/vault-types.js';

/**
 * `GET /api/review/week?end=YYYY-MM-DD` (SPEC F26.1): the weekly review of the seven local days
 * ending on `end` (default: today by the vault's clock). Read-only. `end` must lie in
 * 1970-01-01…9998-12-31: the review also reads the six days before it and the seven after it,
 * which must stay valid dates (`9999-12-31` answered 500 before, review L9).
 */
const MIN_END = '1970-01-01';
const MAX_END = '9998-12-31';
export function registerReviewRoutes(app: FastifyInstance, context: AppContext): void {
  app.get<{ Querystring: { end?: string } }>(
    '/api/review/week',
    {
      schema: {
        querystring: { type: 'object', properties: { end: { type: 'string', maxLength: 20 } } },
      },
    },
    async (request, reply) => {
      const end = request.query.end ?? context.activity.today();
      if (!isCalendarDate(end) || end < MIN_END || end > MAX_END) {
        throw new VaultError('VALIDATION', 'end must be a calendar date YYYY-MM-DD', {
          reason: 'end',
        });
      }
      reply.header('cache-control', 'no-store');
      return buildWeekReview(
        { activity: context.activity, index: context.index, deadlines: context.deadlines },
        end,
      );
    },
  );
}
