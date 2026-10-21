import type { GlobalSettings } from '../../config/global-settings.js';
import { hasChatConsent, hasEmbeddingsConsent } from '../../config/settings-sections.js';
import type { AiStatus } from '../ai-types.js';
import { monthKey, type MonthUsage } from '../budget/usage-store.js';
import { chatModelOf, embeddingConfigOf } from '../providers/default-models.js';
import { chatBlock, hasProviderKey } from './ai-readiness.js';

export interface EmbeddingsSnapshot {
  state: AiStatus['embeddings']['state'];
  done: number;
  total: number;
  pending: number;
  lastError: string | null;
  /** True when `embeddings()` would return an index (hybrid retrieval). */
  available: boolean;
}

export const EMBEDDINGS_OFF: EmbeddingsSnapshot = {
  state: 'off',
  done: 0,
  total: 0,
  pending: 0,
  lastError: null,
  available: false,
};

/** `GET /api/ai/status` from the settings, the month's usage and the embedding jobs. */
export function buildAiStatus(
  settings: GlobalSettings,
  usage: MonthUsage & { month: string },
  embeddings: EmbeddingsSnapshot,
  scope: string[],
  available = true,
): AiStatus {
  const { ai } = settings;
  const limit = ai.monthlyTokenLimit;
  const paused = usage.tokens >= limit;
  const reason = available ? chatBlock(ai, paused) : 'disabled';
  const config = embeddingConfigOf(ai);
  return {
    available,
    enabled: available && ai.enabled,
    consented: hasChatConsent(ai),
    provider: ai.provider,
    hasKey: hasProviderKey(ai, ai.provider),
    chatModel: chatModelOf(ai),
    ready: reason === null,
    reason,
    retrieval: embeddings.available ? 'hybrid' : 'bm25',
    embeddings: {
      enabled: available && ai.embeddings,
      consented: hasEmbeddingsConsent(ai),
      provider: config.provider,
      model: config.model,
      hasKey: hasProviderKey(ai, config.provider),
      state: embeddings.state,
      done: embeddings.done,
      total: embeddings.total,
      pending: embeddings.pending,
      lastError: embeddings.lastError,
    },
    usage: { month: usage.month, tokens: usage.tokens, limit, paused },
    scope,
  };
}

/** The status when the AI plugin does not run for the open vault: everything off. */
export function unavailableAiStatus(settings: GlobalSettings, now: Date): AiStatus {
  return buildAiStatus(
    settings,
    { month: monthKey(now), tokens: 0, requests: 0 },
    EMBEDDINGS_OFF,
    [],
    false,
  );
}
