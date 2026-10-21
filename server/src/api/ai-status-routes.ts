/**
 * `GET /api/ai/status` and `POST /api/ai/embeddings/rebuild` (SPEC §9, F33). The AI plugin is
 * looked up per request (a vault switch replaces it); without it the status says
 * `available: false` with everything off. Also exports the `AiError` → HTTP mapping for the other
 * AI routes.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { AI_ERROR_STATUS, AiError, type AiRuntime, type AiStatus } from '../ai/ai-types.js';
import { unavailableAiStatus } from '../ai/runtime/ai-status.js';
import type { AppContext } from '../app-context/create-app-context.js';
import { AI_PLUGIN } from '../app-context/vault-plugins.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { ApiError, apiErrorBody } from '../http/api-errors.js';
import { assertBody, type BodySchema } from '../http/strict-body-schema.js';

export interface AiStatusRouteOptions {
  settings: () => GlobalSettings;
}

/** The HTTP error for an `AiError` (status from `AI_ERROR_STATUS`, code, details). */
export function aiApiError(error: AiError): ApiError {
  return new ApiError(AI_ERROR_STATUS[error.code], error.code, error.message, error.details);
}

/** Sends an `AiError` as `{ error: { code, message, details } }` with its status. */
export function sendAiError(reply: FastifyReply, error: AiError): FastifyReply {
  return reply
    .code(AI_ERROR_STATUS[error.code])
    .type('application/json; charset=utf-8')
    .send(apiErrorBody(error.code, error.message, error.details));
}

/** An empty JSON object or no body at all. */
const EMPTY_BODY: BodySchema = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {},
};

export function registerAiStatusRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: AiStatusRouteOptions,
): void {
  app.get('/api/ai/status', async (_request, reply): Promise<AiStatus> => {
    await context.settled();
    reply.header('cache-control', 'no-store');
    const runtime = context.plugin<AiRuntime>(AI_PLUGIN);
    return runtime ? runtime.status() : unavailableAiStatus(options.settings(), context.now());
  });

  app.post('/api/ai/embeddings/rebuild', async (request, reply) => {
    if (request.body !== undefined) assertBody(EMPTY_BODY, request.body);
    await context.settled();
    const runtime = context.plugin<AiRuntime>(AI_PLUGIN);
    if (!runtime) throw new ApiError(503, 'UNAVAILABLE', 'AI is not running for this vault.');
    try {
      runtime.assertReady('embed');
    } catch (error) {
      if (error instanceof AiError) throw aiApiError(error);
      throw error;
    }
    const started = runtime.rebuildEmbeddings();
    return reply.code(202).send({ started });
  });
}
