/** Test helpers for the AI actions: a ready AI status with the default scope. */
import type { AiStatus } from '../../lib/api/ai-types';
import { useAiStatusStore } from '../../lib/ai-status-store';

export function readyStatus(overrides: Partial<AiStatus> = {}): AiStatus {
  return {
    available: true,
    enabled: true,
    consented: true,
    provider: 'anthropic',
    hasKey: true,
    chatModel: 'claude-haiku-5-5',
    ready: true,
    reason: null,
    retrieval: 'bm25',
    embeddings: {
      enabled: false,
      consented: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      hasKey: false,
      state: 'off',
      done: 0,
      total: 0,
      pending: 0,
      lastError: null,
    },
    usage: { month: '2026-10', tokens: 0, limit: 2_000_000, paused: false },
    scope: ['', '0 Inbox', '1 Projects', '2 Areas', 'Daily', 'wiki'],
    ...overrides,
  };
}

/** Puts a status in the store (null = not known yet). */
export function setAiStatus(status: AiStatus | null): void {
  useAiStatusStore.setState({ status });
}
