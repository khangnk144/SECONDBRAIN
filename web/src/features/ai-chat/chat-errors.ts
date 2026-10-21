/**
 * What a failed answer says (design.md §7: what happened, what to do next). Provider failures are
 * told apart by the server's reason; readiness refusals (AI off, no key, limit) use the same words
 * as the "not ready" notice.
 */
import type { TFunction } from 'i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import { ApiError } from '../../lib/api-client';
import type { AiStatus } from '../../lib/api/ai-types';
import type { AiProvider } from '../../lib/api/settings-types';
import type { ChatFailure } from './chat-types';

const PROVIDER_REASONS = [
  'network',
  'timeout',
  'auth',
  'rate-limit',
  'quota',
  'bad-request',
  'server',
  'malformed',
  'aborted',
] as const;

/** The SSE `error` event has no details today; its message ends with "(<reason>)". */
const REASON_IN_MESSAGE = /\(([a-z-]+)\)\.?\s*$/;

function knownReason(value: unknown): string | null {
  return typeof value === 'string' && (PROVIDER_REASONS as readonly string[]).includes(value)
    ? value
    : null;
}

export function failureFromEvent(
  event: { code: string; message: string; details?: Record<string, unknown> },
  provider: AiProvider | null,
): ChatFailure {
  const reason =
    knownReason(event.details?.reason) ??
    knownReason(REASON_IN_MESSAGE.exec(event.message ?? '')?.[1]);
  return { code: event.code, reason, provider };
}

export function failureFromError(error: unknown, provider: AiProvider | null): ChatFailure {
  if (error instanceof ApiError) {
    const reason = typeof error.details.reason === 'string' ? error.details.reason : null;
    return { code: error.code, reason, provider };
  }
  // `fetch` rejects with a TypeError when the app's own server cannot be reached.
  if (error instanceof TypeError) return { code: 'NETWORK', reason: null, provider };
  return { code: 'INTERNAL', reason: null, provider };
}

/** Refusals that mean "AI is not ready": the status is reloaded and the notice explains. */
export function isReadinessFailure(failure: ChatFailure): boolean {
  return ['AI_DISABLED', 'AI_NO_KEY', 'AI_BUDGET'].includes(failure.code);
}

/** Readiness, auth and model problems are fixed in Settings. */
export function failureNeedsSettings(failure: ChatFailure): boolean {
  return (
    isReadinessFailure(failure) ||
    (failure.code === 'AI_PROVIDER_ERROR' &&
      (failure.reason === 'auth' || failure.reason === 'bad-request'))
  );
}

const REASON_KEYS: Record<string, string> = {
  network: 'network',
  timeout: 'timeout',
  auth: 'auth',
  'rate-limit': 'rateLimit',
  quota: 'quota',
  'bad-request': 'badRequest',
  server: 'server',
  malformed: 'malformed',
};

export function providerName(provider: AiProvider | null, t: TFunction): string {
  return aiProviderName(provider, t);
}

export function formatTokens(value: number, language: string): string {
  return new Intl.NumberFormat(language === 'en' ? 'en-US' : 'vi-VN').format(value);
}

export function budgetMessage(status: AiStatus | null, t: TFunction, language: string): string {
  if (status && status.usage.paused) {
    return t('ai-chat.notReady.budget', { limit: formatTokens(status.usage.limit, language) });
  }
  // The question alone would cross what is left of the month's limit.
  return t('ai-chat.errors.overBudget');
}

export function failureMessage(
  failure: ChatFailure,
  t: TFunction,
  status: AiStatus | null,
  language: string,
): string {
  const provider = providerName(failure.provider, t);
  switch (failure.code) {
    case 'AI_PROVIDER_ERROR': {
      const key = failure.reason ? REASON_KEYS[failure.reason] : undefined;
      return t(`ai-chat.errors.${key ?? 'provider'}`, { provider });
    }
    case 'AI_DISABLED':
      // The server refuses a missing consent (after a provider change) with this code too.
      return t(
        failure.reason === 'no-consent' || status?.reason === 'no-consent'
          ? 'ai-chat.notReady.reconsent'
          : 'ai-chat.notReady.disabled',
      );
    case 'AI_NO_KEY':
      return t('ai-chat.notReady.noKey');
    case 'AI_BUDGET':
      return budgetMessage(status, t, language);
    case 'NETWORK':
      return t('ai-chat.errors.appOffline');
    case 'INCOMPLETE':
      return t('ai-chat.errors.incomplete');
    case 'UNAVAILABLE':
      return t('ai-chat.errors.unavailable');
    default:
      return t('ai-chat.errors.generic');
  }
}
