/** What the embedding jobs do after a failed pass (SPEC F33.4 "retry/backoff"). */
import { errorCodeOf } from '../../app-context/app-context-errors.js';
import { AiError } from '../ai-types.js';
import { isAbortedError } from '../providers/provider-http.js';

/** 1 min, 5 min, 30 min, then every 2 h. */
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000];

export type FailureAction =
  /** Cancelled, or AI was switched off meanwhile: the settings change re-evaluates. */
  | { kind: 'ignore' }
  /** The budget would be passed: wait for next month or a higher limit. */
  | { kind: 'budget'; code: 'budget' }
  /** The key or the account is the problem: no retry until the settings change. */
  | { kind: 'halt'; code: string }
  | { kind: 'retry'; code: string; delayMs: number };

export function failureAction(error: unknown, attempt: number): FailureAction {
  if (isAbortedError(error)) return { kind: 'ignore' };
  const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
  if (!(error instanceof AiError)) return { kind: 'retry', code: errorCodeOf(error), delayMs };
  if (error.code === 'AI_BUDGET') return { kind: 'budget', code: 'budget' };
  if (error.code !== 'AI_PROVIDER_ERROR') return { kind: 'ignore' };
  const reason = String(error.details?.reason ?? 'server');
  if (reason === 'auth' || reason === 'quota') return { kind: 'halt', code: reason };
  return { kind: 'retry', code: reason, delayMs };
}
