/** Budget rules of SPEC F33 ("monthly cost cap, token estimate"). */
import { AiError, type ChatRequest } from '../ai-types.js';
import type { UsageReservation, UsageStore } from './usage-store.js';

/** Estimated tokens of a chat request: its characters / 4 plus the whole output allowance. */
export function estimateChatTokens(request: ChatRequest): number {
  let characters = request.system.length;
  for (const message of request.messages) characters += message.content.length;
  return Math.ceil(characters / 4) + request.maxTokens;
}

export function budgetError(): AiError {
  return new AiError('AI_BUDGET', 'The monthly AI limit is reached; AI is paused.');
}

/** Refuses a call whose estimate would cross the limit (the limit itself is never passed). */
export function assertWithinBudget(used: number, estimate: number, limit: number): void {
  if (used >= limit || used + estimate > limit) throw budgetError();
}

/** Recorded usage plus the estimates held by requests in flight. */
export function committedTokens(usage: UsageStore, now: Date): number {
  return usage.month(now).tokens + usage.reserved();
}

/**
 * Checks the budget counting the requests in flight and holds this request's estimate until it
 * settles (in one synchronous step, so concurrent requests cannot all pass the same check).
 */
export function reserveWithinBudget(
  usage: UsageStore,
  estimate: number,
  limit: number,
  now: Date,
): UsageReservation {
  assertWithinBudget(committedTokens(usage, now), estimate, limit);
  return usage.reserve(estimate);
}
