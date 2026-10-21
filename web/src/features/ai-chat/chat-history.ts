import type { ChatHistoryMessage } from '../../lib/api/ai-types';
import type { ChatTurn } from './chat-types';

/** The server accepts at most 10 earlier messages of at most 8,000 characters each. */
export const HISTORY_LIMIT = 10;
export const HISTORY_CONTENT_LIMIT = 8_000;

const clip = (text: string) =>
  text.length > HISTORY_CONTENT_LIMIT ? text.slice(0, HISTORY_CONTENT_LIMIT) : text;

/**
 * The earlier turns sent with a new question: only questions that got a finished answer (a
 * stopped or failed turn is left out, so the model never continues a broken answer), as
 * question/answer pairs, the last 10 messages.
 */
export function chatHistory(turns: readonly ChatTurn[]): ChatHistoryMessage[] {
  const messages: ChatHistoryMessage[] = [];
  turns.forEach((turn, index) => {
    if (turn.role !== 'assistant' || turn.status !== 'done' || !turn.done) return;
    const asked = turns[index - 1];
    if (asked?.role !== 'user') return;
    messages.push({ role: 'user', content: clip(asked.text) });
    messages.push({ role: 'assistant', content: clip(turn.done.answer) });
  });
  return messages.slice(-HISTORY_LIMIT);
}
