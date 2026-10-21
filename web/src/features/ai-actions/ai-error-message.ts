/**
 * What to tell her when an AI request fails: what happened and what to do next (design.md §7),
 * by the server's code and reason. Readiness refusals (AI turned off meanwhile, no key, budget)
 * use the same sentences as the checks made before sending.
 */
import { aiProviderName } from '../../lib/ai-provider-name';
import { isApiError } from '../../lib/api-client';
import type { AiStatus } from '../../lib/api/ai-types';
import { blockerMessage, type AiBlocker } from './ai-readiness';

export interface AiErrorView {
  key: string;
  values: Record<string, string>;
  /** Settings can fix it ("Mở Cài đặt AI"). */
  settings: boolean;
  /** Asking again may work ("Thử lại"). */
  retry: boolean;
}

const PROVIDER_REASONS = new Set([
  'network',
  'timeout',
  'auth',
  'rate-limit',
  'quota',
  'bad-request',
  'server',
  'malformed',
  'invalid-answer',
]);
const NOTE_REASONS = new Set(['not-a-note', 'not-in-inbox', 'not-utf8']);

const READINESS_CODES: Record<string, AiBlocker> = {
  AI_DISABLED: 'disabled',
  AI_NO_KEY: 'no-key',
  AI_BUDGET: 'budget',
  UNAVAILABLE: 'unavailable',
};

/** The provider's display name for messages. */
export function providerValues(
  status: AiStatus | null,
  t: (key: string) => string,
): { provider: string } {
  return { provider: aiProviderName(status?.provider ?? 'anthropic', t) };
}

/**
 * The embedding provider's name when the server also searches by meaning (`hybrid`): the text
 * used to find related notes then goes to that provider too. Null in keyword-only mode.
 */
export function meaningProviderValues(
  status: AiStatus | null,
  t: (key: string) => string,
): { provider: string } | null {
  if (status?.retrieval !== 'hybrid') return null;
  return { provider: aiProviderName(status.embeddings.provider, t) };
}

/** A text action that came back empty (shown like an error, with "Thử lại"). */
export const EMPTY_ANSWER = new Error('empty-answer');

export function aiErrorView(
  error: unknown,
  status: AiStatus | null,
  t: (key: string) => string,
  locale: string,
): AiErrorView {
  const provider = providerValues(status, t);
  if (error === EMPTY_ANSWER) {
    return { key: 'ai-actions.errors.emptyAnswer', values: {}, settings: false, retry: true };
  }
  if (!isApiError(error)) {
    // fetch itself failed: the local server is not answering.
    return { key: 'ai-actions.errors.offline', values: {}, settings: false, retry: true };
  }
  const reason = typeof error.details['reason'] === 'string' ? error.details['reason'] : '';
  // A missing consent (after a provider change) comes as AI_DISABLED with its own reason.
  const blocker =
    error.code === 'AI_DISABLED' && reason === 'no-consent'
      ? 'no-consent'
      : READINESS_CODES[error.code];
  if (blocker) {
    const message = blockerMessage(blocker, status, locale);
    return { ...message, settings: blocker !== 'unavailable', retry: blocker === 'unavailable' };
  }
  if (error.code === 'AI_PROVIDER_ERROR' && PROVIDER_REASONS.has(reason)) {
    return {
      key: `ai-actions.errors.${reason}`,
      values: provider,
      settings: reason === 'auth',
      retry: reason !== 'auth',
    };
  }
  if (error.code === 'VALIDATION' && reason === 'out-of-scope') {
    return { ...blockerMessage('out-of-scope', status, locale), settings: true, retry: false };
  }
  if (error.code === 'VALIDATION' && NOTE_REASONS.has(reason)) {
    return { key: `ai-actions.errors.${reason}`, values: {}, settings: false, retry: false };
  }
  if (error.code === 'AI_PROVIDER_ERROR') {
    return { key: 'ai-actions.errors.server', values: provider, settings: false, retry: true };
  }
  return { key: 'ai-actions.errors.generic', values: {}, settings: false, retry: true };
}

/** True when the request was cancelled on purpose ("Hủy", panel closed). */
export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}
