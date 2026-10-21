/**
 * In-app AI routes (SPEC F33, §9): chat (SSE), editor actions, the Today line, saving an answer
 * and semantic search. The AI plugin is looked up per request (null → 503 `UNAVAILABLE`) and
 * `assertReady` runs before anything else; `AiError`s become `{ error: { code } }`. No
 * conversation is stored; logs carry route, outcome, counts and duration only.
 */
import type { FastifyInstance } from 'fastify';
import { runAction } from '../ai/actions/run-action.js';
import { AiError, type AiPurpose, type AiRuntime } from '../ai/ai-types.js';
import { prepareChat } from '../ai/answers/chat-pipeline.js';
import type { PreparedChat } from '../ai/answers/chat-types.js';
import {
  AI_CHAT_SCHEMA,
  AI_SEARCH_SCHEMA,
  EMPTY_BODY,
  type ChatBody,
  type SearchBody,
} from '../ai/answers/route-schemas.js';
import { aiRouteLogger, outcomeOf } from '../ai/answers/route-support.js';
import { saveAnswer } from '../ai/answers/save-answer.js';
import { abortOnDisconnect, streamPreparedChat } from '../ai/answers/sse-writer.js';
import {
  cachedTodaySummary,
  createSingleFlight,
  generateTodaySummary,
  type TodaySummary,
} from '../ai/answers/today-summary.js';
import { toAnswerLanguage } from '../ai/prompts/answer-language.js';
import { semanticSearch } from '../ai/retrieval/semantic-search.js';
import type { AppContext } from '../app-context/create-app-context.js';
import { AI_PLUGIN, SOURCES_PLUGIN } from '../app-context/vault-plugins.js';
import { ApiError } from '../http/api-errors.js';
import { assertBody } from '../http/strict-body-schema.js';
import { toLocalDate } from '../lib/local-date.js';
import type { SourceTextService } from '../sources/source-types.js';
import { aiApiError } from './ai-status-routes.js';
import { guardNotePath } from './vault-route-schemas.js';

export interface AiRouteOptions {
  /** Global settings: the UI language decides an answer's language when the question does not. */
  settings?: () => { [key: string]: unknown };
}

const asHttpError = (error: unknown) => (error instanceof AiError ? aiApiError(error) : error);
const unavailable = () => new ApiError(503, 'UNAVAILABLE', 'AI is not running for this vault.');

export function registerAiRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: AiRouteOptions = {},
): void {
  const uiLanguage = () =>
    toAnswerLanguage((options.settings?.().ui as { language?: unknown } | undefined)?.language);
  const log = aiRouteLogger(() => context.logger);
  const today = () => toLocalDate(context.now());
  const runtimeOf = () => context.plugin<AiRuntime>(AI_PLUGIN);
  /** The open vault's AI runtime, ready for `purpose` (else the JSON error). */
  const readyRuntime = (purpose: AiPurpose): AiRuntime => {
    const runtime = runtimeOf();
    if (!runtime) throw unavailable();
    try {
      runtime.assertReady(purpose);
    } catch (error) {
      throw asHttpError(error);
    }
    return runtime;
  };
  const readers = () => ({
    index: context.index,
    vault: context.vault,
    sources: context.plugin<SourceTextService>(SOURCES_PLUGIN),
  });

  app.post('/api/ai/chat', async (request, reply) => {
    const started = performance.now();
    const runtime = readyRuntime('chat');
    const body = assertBody<ChatBody>(AI_CHAT_SCHEMA, request.body);
    const question = body.question.normalize('NFC').trim();
    if (question === '') {
      throw new ApiError(400, 'VALIDATION', 'Ask a question first.', {
        field: 'question',
        reason: 'required',
      });
    }
    const notePath = body.notePath ? guardNotePath(body.notePath) : null;
    await context.settled();
    const controller = abortOnDisconnect(reply);
    let prepared: PreparedChat;
    try {
      prepared = await prepareChat(
        { question, history: body.history ?? [], notePath },
        {
          ...readers(),
          runtime,
          deadlines: context.deadlines,
          today: today(),
          uiLanguage: uiLanguage(),
          signal: controller.signal,
        },
      );
      // Readiness and budget of the answer call are checked here: still a JSON error.
      prepared.begin();
    } catch (error) {
      log('chat', outcomeOf(error, controller.signal.aborted), '', started);
      throw asHttpError(error);
    }
    const result = await streamPreparedChat(reply, prepared, controller.signal);
    log('chat', result.outcome, result.counts, started);
  });

  app.post('/api/ai/action', async (request, reply) => {
    const started = performance.now();
    const runtime = readyRuntime('action');
    await context.settled();
    const controller = abortOnDisconnect(reply);
    const action = (request.body as { action?: unknown } | null)?.action;
    const counts = `action=${typeof action === 'string' ? action.slice(0, 40) : '-'}`;
    try {
      const result = await runAction(request.body, {
        ...readers(),
        runtime,
        uiLanguage: uiLanguage(),
        signal: controller.signal,
      });
      log('action', 'ok', counts, started);
      return result;
    } catch (error) {
      log('action', outcomeOf(error, controller.signal.aborted), counts, started);
      throw asHttpError(error);
    }
  });

  // Reads the cache only: never a provider call, never a write.
  app.get('/api/ai/today-summary', async (_request, reply): Promise<TodaySummary> => {
    reply.header('cache-control', 'no-store');
    return cachedTodaySummary(context.vault.paths.cacheDir, today(), uiLanguage());
  });

  const once = createSingleFlight<TodaySummary>();
  app.post('/api/ai/today-summary', async (request, reply): Promise<TodaySummary> => {
    if (request.body !== undefined && request.body !== null) assertBody(EMPTY_BODY, request.body);
    reply.header('cache-control', 'no-store');
    const started = performance.now();
    const date = today();
    const language = uiLanguage();
    const runtime = runtimeOf();
    if (!runtime) throw unavailable();
    try {
      runtime.assertReady('today');
    } catch (error) {
      // Not ready (off, no key, budget): no line today, and nothing is sent.
      if (error instanceof AiError) return { date, text: null };
      throw error;
    }
    await context.settled();
    try {
      const summary = await once(`${context.vault.id}|${date}|${language}`, () =>
        generateTodaySummary({
          runtime,
          deadlines: context.deadlines,
          cacheDir: context.vault.paths.cacheDir,
          language,
        }),
      );
      log('today', 'ok', '', started);
      return summary;
    } catch (error) {
      log('today', outcomeOf(error, false), '', started);
      throw asHttpError(error);
    }
  });

  // A local write only (no AI call): an answer can be kept even after AI was turned off.
  app.post('/api/ai/save-answer', async (request, reply) => {
    const result = await saveAnswer(request.body, {
      vault: context.vault,
      catalog: () => context.index.linkCatalog(),
      now: context.now(),
      language: uiLanguage(),
    });
    await context.settled();
    return reply.code(201).send(result);
  });

  app.post('/api/ai/search', async (request, reply) => {
    const started = performance.now();
    const runtime = readyRuntime('search');
    const body = assertBody<SearchBody>(AI_SEARCH_SCHEMA, request.body);
    await context.settled();
    const controller = abortOnDisconnect(reply);
    reply.header('cache-control', 'no-store');
    try {
      const result = await semanticSearch(body.q.normalize('NFC'), body.limit ?? 10, {
        ...readers(),
        runtime,
        signal: controller.signal,
      });
      log('search', 'ok', `mode=${result.mode} results=${result.results.length}`, started);
      return result;
    } catch (error) {
      log('search', outcomeOf(error, controller.signal.aborted), '', started);
      throw asHttpError(error);
    }
  });
}
