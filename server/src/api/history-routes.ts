import type { FastifyInstance, FastifyReply } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { HISTORY_PLUGIN } from '../app-context/vault-plugins.js';
import { GitCommandError } from '../git/git-runner.js';
import { sendApiError } from '../http/api-errors.js';
import {
  HistoryUnavailableError,
  type HistoryService,
  type HistoryStatus,
} from '../git/history-types.js';
import { VaultError } from '../vault/vault-types.js';
import {
  guardNotePath,
  pathQuerySchema,
  revisionSchema,
  vaultPathSchema,
  type PathQuery,
} from './vault-route-schemas.js';

const commitSchema = { type: 'string', pattern: '^[0-9a-f]{7,40}$' } as const;

const NOT_STARTED: HistoryStatus = { available: false, reason: 'not-started', lastCommitAt: null };

/** Looked up per request: the plugin belongs to the vault that is open right now. */
const historyOf = (context: AppContext) => context.plugin<HistoryService>(HISTORY_PLUGIN);

/** 503 `UNAVAILABLE`: history needs git (SPEC F20); `details.reason` says why. */
function sendUnavailable(reply: FastifyReply, reason: string): FastifyReply {
  return sendApiError(reply, 503, 'UNAVAILABLE', 'Version history is not available.', { reason });
}

/** The history service when it can answer, else the 503 already sent. */
function availableHistory(context: AppContext, reply: FastifyReply): HistoryService | null {
  const history = historyOf(context);
  const status = history?.status() ?? NOT_STARTED;
  if (history && status.available) return history;
  sendUnavailable(reply, status.reason ?? 'not-started');
  return null;
}

/** Runs `work`; "no history" and a failing git command become 503 (logged as a code). */
async function orUnavailable<T>(
  context: AppContext,
  reply: FastifyReply,
  work: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HistoryUnavailableError) return sendUnavailable(reply, error.reason);
    if (error instanceof GitCommandError) {
      context.logger.warn(`History: git failed while answering a request (${error.code}).`);
      return sendUnavailable(reply, 'git-failed');
    }
    throw error;
  }
}

/**
 * Version history of notes (SPEC F20.3, §9): status, the commits of one note, its text at a
 * commit, and restoring that text (a revision-checked write, then a commit). Without git the
 * listing answers `available: false` and the others 503 `UNAVAILABLE`; nothing else changes.
 */
export function registerHistoryRoutes(app: FastifyInstance, context: AppContext): void {
  app.get('/api/history/status', async () => historyOf(context)?.status() ?? NOT_STARTED);

  app.get<{ Querystring: PathQuery }>(
    '/api/history',
    { schema: { querystring: pathQuerySchema } },
    async (request, reply) => {
      const path = guardNotePath(request.query.path);
      const history = historyOf(context);
      if (!history?.status().available) return { available: false, commits: [] };
      return orUnavailable(context, reply, async () => ({
        available: true,
        commits: await history.noteHistory(path),
      }));
    },
  );

  app.get<{ Querystring: { path: string; commit: string } }>(
    '/api/history/version',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['path', 'commit'],
          properties: { path: vaultPathSchema, commit: commitSchema },
        },
      },
    },
    async (request, reply) => {
      const path = guardNotePath(request.query.path);
      const history = availableHistory(context, reply);
      if (!history) return reply;
      return orUnavailable(context, reply, async () => {
        const version = await history.noteVersion(path, request.query.commit);
        if (!version) {
          throw new VaultError('NOT_FOUND', 'The note did not exist in that version.', { path });
        }
        return version;
      });
    },
  );

  app.post<{ Body: { path: string; commit: string; expectedRevision: string } }>(
    '/api/history/restore',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'commit', 'expectedRevision'],
          properties: {
            path: vaultPathSchema,
            commit: commitSchema,
            expectedRevision: revisionSchema,
          },
        },
      },
    },
    async (request, reply) => {
      const path = guardNotePath(request.body.path);
      const history = availableHistory(context, reply);
      if (!history) return reply;
      const { commit, expectedRevision } = request.body;
      return orUnavailable(context, reply, () => history.restore(path, commit, expectedRevision));
    },
  );
}
