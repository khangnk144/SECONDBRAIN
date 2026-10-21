/**
 * The conversation the client sends back with each question (the server stores none). Providers
 * want turns that start with the user and alternate, so empty turns are dropped, a leading
 * assistant turn is dropped and consecutive turns of one role are joined.
 */
import type { ChatMessage } from '../ai-types.js';

export function normalizeHistory(history: readonly ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of history) {
    const content = message.content.trim();
    if (content === '') continue;
    if (out.length === 0 && message.role === 'assistant') continue;
    const last = out.at(-1);
    if (last && last.role === message.role) last.content = `${last.content}\n\n${content}`;
    else out.push({ role: message.role, content });
  }
  return out;
}

/** History plus the new user turn (joined to a trailing user turn the client left unanswered). */
export function withQuestion(history: readonly ChatMessage[], content: string): ChatMessage[] {
  return normalizeHistory([...history, { role: 'user', content }]);
}

/** The last question asked before this one (context for follow-up questions). */
export function previousQuestion(history: readonly ChatMessage[]): string | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i]!;
    if (message.role === 'user' && message.content.trim() !== '') return message.content.trim();
  }
  return null;
}
