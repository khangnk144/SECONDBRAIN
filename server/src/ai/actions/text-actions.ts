/**
 * Summarize, Improve wording and Explain on a selection (SPEC F33 editor actions). The text goes
 * as she selected it inside a `<text>` block; the answer comes back as plain text for the editor
 * to offer (nothing is written here). Improve keeps the meaning and language and returns only the
 * rewritten text.
 */
import { textActionSystem, type TextActionName } from '../prompts/action-prompts.js';
import { detectLanguage } from '../prompts/answer-language.js';
import { dataBlock } from '../prompts/data-blocks.js';
import type { ActionDeps } from './action-types.js';

/** A reply wrapped whole in a code fence or quotes is unwrapped (models add them sometimes). */
function unwrap(text: string): string {
  const trimmed = text.trim();
  const fence = /^```[^\n]*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (fence) return fence[1]!.trim();
  const quoted = /^["“]([\s\S]*)["”]$/.exec(trimmed);
  return quoted && !quoted[1]!.includes('"') ? quoted[1]!.trim() : trimmed;
}

/** Room for a rewrite as long as the text (Vietnamese runs about 2–3 characters per token). */
function maxTokensFor(action: TextActionName, text: string): number {
  if (action === 'improve') return Math.min(8000, Math.max(512, Math.ceil(text.length / 2)));
  return action === 'summarize' ? 800 : 1200;
}

export async function runTextAction(
  action: TextActionName,
  text: string,
  deps: ActionDeps,
): Promise<{ action: TextActionName; text: string }> {
  const language = detectLanguage(text, deps.uiLanguage);
  const reply = await deps.runtime.complete({
    purpose: 'action',
    system: textActionSystem(action, language),
    messages: [{ role: 'user', content: dataBlock('text', text) }],
    maxTokens: maxTokensFor(action, text),
    temperature: 0.3,
    signal: deps.signal,
  });
  return { action, text: unwrap(reply.text) };
}
