/**
 * What the embedding jobs and the embedding query need from the plugin, and the one function
 * that sends texts to the embedding provider (readiness, budget, usage, log).
 */
import type { AppContext } from '../../app-context/create-app-context.js';
import type { GlobalSettings } from '../../config/global-settings.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import type { VaultPath } from '../../vault/vault-types.js';
import { reserveWithinBudget } from '../budget/token-budget.js';
import type { UsageStore } from '../budget/usage-store.js';
import { embeddingConfigOf } from '../providers/default-models.js';
import { providerBaseUrl } from '../providers/provider-endpoints.js';
import { EMBED_PROVIDERS } from '../providers/provider-registry.js';
import type { FetchLike, ProviderTimers } from '../providers/provider-types.js';
import { estimateTextTokens } from '../providers/vector-math.js';
import { embedBlock, readinessError } from '../runtime/ai-readiness.js';
import type { EmbeddingsSnapshot } from '../runtime/ai-status.js';
import { outcomeOf } from '../runtime/chat-calls.js';

export interface EmbeddingDeps {
  context: AppContext;
  settings: () => GlobalSettings;
  usage: UsageStore;
  fetch: FetchLike;
  timers: ProviderTimers;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
  logger: AppLogger;
  inScope: (path: VaultPath) => boolean;
  /** After usage was recorded (the runtime announces a budget pause). */
  onUsage: () => void;
  /** Sends `ai:status` to clients. */
  broadcast: (snapshot: EmbeddingsSnapshot) => void;
}

/** Embeds texts with the configured embedding provider; one request (callers keep ≤ 64 texts). */
export async function embedTexts(
  deps: EmbeddingDeps,
  texts: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Float32Array[]> {
  const { ai } = deps.settings();
  const used = deps.usage.month(deps.now()).tokens;
  const block = embedBlock(ai, used >= ai.monthlyTokenLimit);
  if (block) throw readinessError(block, 'embed');
  // Held while the request runs, so chat and other batches in flight count against the limit.
  const reservation = reserveWithinBudget(
    deps.usage,
    estimateTextTokens(texts),
    ai.monthlyTokenLimit,
    deps.now(),
  );
  const config = embeddingConfigOf(ai);
  const started = performance.now();
  let outcome = 'ok';
  let tokens = 0;
  try {
    const result = await EMBED_PROVIDERS[config.provider].embed(
      {
        baseUrl: providerBaseUrl(config.provider, deps.env),
        model: config.model,
        key: ai.apiKeys[config.provider]!,
        fetch: deps.fetch,
        signal,
        timers: deps.timers,
      },
      texts,
      config.dims,
    );
    tokens = result.usage.inputTokens;
    reservation.settle(tokens, deps.now());
    deps.onUsage();
    return result.vectors;
  } catch (error) {
    outcome = outcomeOf(error);
    throw error;
  } finally {
    reservation.settle(0, deps.now()); // a failed request: release the estimate
    const ms = Math.round(performance.now() - started);
    deps.logger.info(`AI embed ${config.provider}: ${outcome}, ${tokens} tokens, ${ms} ms.`);
  }
}
