/**
 * The intent step of the chat (SPEC F33): one small JSON call with today's date, this week and
 * the in-scope course/project/research titles; on a provider error or an unusable reply the local
 * rules decide (no further network). Budget, consent and abort errors are not swallowed.
 */
import { endOfWeekSunday, isoWeekday, startOfWeekMonday } from '../../lib/local-date.js';
import { AiError, type AiRuntime, type TokenUsage } from '../ai-types.js';
import { INTENT_SYSTEM, intentUserMessage } from '../prompts/intent-prompt.js';
import { ruleIntent } from './intent-rules.js';
import type { QuestionIntent } from './intent-types.js';
import { extractJsonObject, validateIntent } from './intent-validate.js';

export interface ClassifyContext {
  runtime: Pick<AiRuntime, 'complete'>;
  /** Local calendar date. */
  today: string;
  /** In-scope titles of `type: course|project|research` notes (≤ 200). */
  topics: readonly string[];
  previousQuestion?: string | null;
  signal?: AbortSignal;
}

export interface ClassifyResult {
  intent: QuestionIntent;
  usage: TokenUsage;
}

const NO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0 };

export async function classifyQuestion(
  question: string,
  context: ClassifyContext,
): Promise<ClassifyResult> {
  const { today, topics } = context;
  try {
    const reply = await context.runtime.complete({
      purpose: 'intent',
      json: true,
      maxTokens: 300,
      temperature: 0,
      system: INTENT_SYSTEM,
      messages: [
        {
          role: 'user',
          content: intentUserMessage({
            question,
            today,
            weekday: isoWeekday(today),
            week: { start: startOfWeekMonday(today), end: endOfWeekSunday(today) },
            topics,
            previousQuestion: context.previousQuestion,
          }),
        },
      ],
      signal: context.signal,
    });
    const intent = validateIntent(extractJsonObject(reply.text), topics, today);
    return { intent: intent ?? ruleIntent(question, today, topics), usage: reply.usage };
  } catch (error) {
    // A closed client is not a provider failure: stop instead of answering by the rules.
    if (context.signal?.aborted) throw error;
    if (!(error instanceof AiError && error.code === 'AI_PROVIDER_ERROR')) throw error;
    return { intent: ruleIntent(question, today, topics), usage: NO_USAGE };
  }
}
