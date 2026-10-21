/**
 * What the semantic index is doing, in one sentence: off, waiting for AI/consent/key/budget, its
 * progress ("Đang tạo chỉ mục theo nghĩa 120/400"), ready, stale after a model change, or the
 * provider error behind a pause or a retry (codes from the server's embedding jobs).
 */
import type { AiStatus, EmbeddingState } from '../../lib/api/ai-types';
import type { SettingsResponse } from '../../lib/api/settings-types';

export interface EmbeddingsProgress {
  state: EmbeddingState;
  done: number;
  total: number;
}

export type EmbeddingsLine =
  | { key: 'off' | 'needsAi' | 'budget' | 'unavailable' | 'queued' | 'idle' | 'stale' }
  | { key: 'consent' | 'reconsent'; consent: true }
  | { key: 'noKey' }
  | { key: 'running'; done: number; total: number }
  | { key: 'error' | 'retrying'; error: string };

/** Provider failure reasons the copy names; anything else reads as the generic error. */
const KNOWN_ERRORS = new Set([
  'auth',
  'quota',
  'network',
  'timeout',
  'rate-limit',
  'server',
  'malformed',
  'budget',
]);

export function embeddingErrorKey(code: string | null): string {
  if (code === 'bad-request') return 'malformed';
  return code !== null && KNOWN_ERRORS.has(code) ? code : 'generic';
}

const EMBEDDING_STATES = new Set<string>(['off', 'idle', 'queued', 'running', 'stale', 'error']);

/** An `ai:status` event's progress, or null when it does not look like one. */
export function progressFromEvent(embeddings: {
  state: string;
  done: number;
  total: number;
}): EmbeddingsProgress | null {
  if (!EMBEDDING_STATES.has(embeddings.state)) return null;
  return { ...embeddings, state: embeddings.state as EmbeddingState };
}

/**
 * `live` is the newest `ai:status` event, applied over the status until the status is read again
 * (the status store refetches on the same event).
 */
export function embeddingsLine(
  ai: SettingsResponse['ai'],
  status: AiStatus | null,
  live: EmbeddingsProgress | null,
): EmbeddingsLine | null {
  if (!ai.embeddings) return { key: 'off' };
  if (!ai.enabled) return { key: 'needsAi' };
  if (!status) return null;
  if (!status.available) return { key: 'unavailable' };
  const embeddings = status.embeddings;
  if (!embeddings.consented) {
    const changed =
      ai.embeddingsConsent !== null && ai.embeddingsConsent.provider !== ai.embeddingProvider;
    return { key: changed ? 'reconsent' : 'consent', consent: true };
  }
  if (!embeddings.hasKey) return { key: 'noKey' };
  const { state, done, total } = live ?? embeddings;
  const lastError = embeddings.lastError;
  if (status.usage.paused || (state === 'off' && lastError === 'budget')) return { key: 'budget' };
  switch (state) {
    case 'running':
      return { key: 'running', done, total };
    case 'queued':
      return lastError
        ? { key: 'retrying', error: embeddingErrorKey(lastError) }
        : { key: 'queued' };
    case 'idle':
      return { key: 'idle' };
    case 'stale':
      return { key: 'stale' };
    case 'error':
      return { key: 'error', error: embeddingErrorKey(lastError) };
    case 'off':
      // Settings just changed and the jobs have not picked it up yet.
      return { key: 'queued' };
  }
}
