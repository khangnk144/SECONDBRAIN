/**
 * Whether AI may send anything now (SPEC F33 consent, key, cost cap). Pure functions of the
 * settings and the month's usage: no network, no disk. Order of checks: disabled → no-consent →
 * no-key → budget.
 */
import {
  hasChatConsent,
  hasEmbeddingsConsent,
  type AiSettings,
} from '../../config/settings-sections.js';
import { AiError, type AiPurpose } from '../ai-types.js';
import { budgetError } from '../budget/token-budget.js';

export type ReadyBlock = 'disabled' | 'no-consent' | 'no-key' | 'budget';

const hasKey = (ai: AiSettings, provider: keyof AiSettings['apiKeys']): boolean =>
  typeof ai.apiKeys[provider] === 'string' && ai.apiKeys[provider] !== '';

export function chatBlock(ai: AiSettings, paused: boolean): ReadyBlock | null {
  if (!ai.enabled) return 'disabled';
  if (!hasChatConsent(ai)) return 'no-consent';
  if (!hasKey(ai, ai.provider)) return 'no-key';
  return paused ? 'budget' : null;
}

/** Embeddings need AI on and their own opt-in, consent and key (the embedding provider's). */
export function embedBlock(ai: AiSettings, paused: boolean): ReadyBlock | null {
  if (!ai.enabled || !ai.embeddings) return 'disabled';
  if (!hasEmbeddingsConsent(ai)) return 'no-consent';
  if (!hasKey(ai, ai.embeddingProvider)) return 'no-key';
  return paused ? 'budget' : null;
}

export function blockFor(purpose: AiPurpose, ai: AiSettings, paused: boolean): ReadyBlock | null {
  return purpose === 'embed' ? embedBlock(ai, paused) : chatBlock(ai, paused);
}

export function readinessError(block: ReadyBlock, purpose: AiPurpose): AiError {
  const what = purpose === 'embed' ? 'Embeddings' : 'AI';
  switch (block) {
    case 'disabled':
      return new AiError('AI_DISABLED', `${what} is turned off.`, { reason: 'disabled' });
    case 'no-consent':
      return new AiError('AI_DISABLED', `${what} needs your consent for this provider first.`, {
        reason: 'no-consent',
      });
    case 'no-key':
      return new AiError('AI_NO_KEY', 'There is no API key for this provider.', {
        reason: 'no-key',
      });
    case 'budget':
      return budgetError();
  }
}

export { hasKey as hasProviderKey };
