/**
 * `AiRuntime.stream` / `complete`: readiness and budget are checked before anything is sent, the
 * request's estimate is held while it runs, the configured provider is called, and the real usage
 * (else an estimate) replaces the held estimate. The log line
 * holds purpose, provider, outcome code, tokens and duration – never the prompt or the answer.
 */
import type { GlobalSettings } from '../../config/global-settings.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import { AiError, type ChatRequest, type ChatStreamEvent, type TokenUsage } from '../ai-types.js';
import {
  assertWithinBudget,
  committedTokens,
  estimateChatTokens,
  reserveWithinBudget,
} from '../budget/token-budget.js';
import type { UsageStore } from '../budget/usage-store.js';
import { chatModelOf } from '../providers/default-models.js';
import { providerBaseUrl } from '../providers/provider-endpoints.js';
import { CHAT_PROVIDERS } from '../providers/provider-registry.js';
import type { FetchLike, ProviderTimers } from '../providers/provider-types.js';
import { blockFor, readinessError } from './ai-readiness.js';

export interface ChatCallDeps {
  settings: () => GlobalSettings;
  usage: UsageStore;
  fetch: FetchLike;
  timers: ProviderTimers;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
  logger: AppLogger;
  /** Called after usage was recorded (the runtime announces a budget pause). */
  onUsage: () => void;
}

/** Short outcome word for the log: `ok`, an AI code, or `AI_PROVIDER_ERROR:<reason>`. */
export function outcomeOf(error: unknown): string {
  if (!(error instanceof AiError)) return error instanceof Error ? error.name : 'unknown';
  const reason = error.details?.reason;
  return typeof reason === 'string' && error.code === 'AI_PROVIDER_ERROR'
    ? `${error.code}:${reason}`
    : error.code;
}

/** Throws `AiError` when chat may not run now (no network). */
export function assertChatReady(deps: ChatCallDeps, request: ChatRequest): void {
  const { ai } = deps.settings();
  const used = deps.usage.month(deps.now()).tokens;
  const block = blockFor(request.purpose, ai, used >= ai.monthlyTokenLimit);
  if (block) throw readinessError(block, request.purpose);
  assertWithinBudget(
    committedTokens(deps.usage, deps.now()),
    estimateChatTokens(request),
    ai.monthlyTokenLimit,
  );
}

/**
 * Checks synchronously (throws before returning), then returns the stream. Leaving the loop early
 * cancels the provider request.
 */
export function streamChat(
  deps: ChatCallDeps,
  request: ChatRequest,
): AsyncIterable<ChatStreamEvent> {
  assertChatReady(deps, request);
  const { ai } = deps.settings();
  const provider = ai.provider;
  const call = {
    baseUrl: providerBaseUrl(provider, deps.env),
    model: chatModelOf(ai),
    key: ai.apiKeys[provider]!,
    fetch: deps.fetch,
    signal: request.signal,
    timers: deps.timers,
  };
  const estimate = estimateChatTokens(request);
  const inputEstimate = estimate - request.maxTokens;

  async function* run(): AsyncGenerator<ChatStreamEvent> {
    // Checked again and held when the stream starts (requests started meanwhile count), and
    // only then: a stream that is never read holds nothing.
    const reservation = reserveWithinBudget(
      deps.usage,
      estimate,
      deps.settings().ai.monthlyTokenLimit,
      deps.now(),
    );
    const started = performance.now();
    let usage: TokenUsage | null = null;
    let received = 0;
    let outcome = 'ok';
    try {
      for await (const event of CHAT_PROVIDERS[provider].streamChat(call, request)) {
        if (event.type === 'delta') received += event.text.length;
        else usage = event.usage;
        yield event;
      }
    } catch (error) {
      outcome = outcomeOf(error);
      throw error;
    } finally {
      const reported = usage ? usage.inputTokens + usage.outputTokens : 0;
      let tokens = reported;
      if (tokens === 0 && usage) tokens = estimate;
      else if (tokens === 0 && received > 0) tokens = inputEstimate + Math.ceil(received / 4);
      reservation.settle(tokens, deps.now());
      if (tokens > 0) deps.onUsage();
      const ms = Math.round(performance.now() - started);
      deps.logger.info(
        `AI ${request.purpose} ${provider}: ${outcome}, ${tokens} tokens, ${ms} ms.`,
      );
    }
  }
  return run();
}

export async function completeChat(
  deps: ChatCallDeps,
  request: ChatRequest,
): Promise<{ text: string; usage: TokenUsage }> {
  let text = '';
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for await (const event of streamChat(deps, request)) {
    if (event.type === 'delta') text += event.text;
    else usage = event.usage;
  }
  return { text, usage };
}
