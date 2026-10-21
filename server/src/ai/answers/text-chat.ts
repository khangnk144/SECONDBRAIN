/**
 * Text questions (SPEC F33 "Retrieval", "Citations", F33.2): retrieved chunks go to the model as
 * `<source>` blocks; after the stream the answer's citations are checked. Nothing retrieved → a
 * fixed "không tìm thấy" answer with notice `empty` and no model call.
 */
import type { ChatStreamEvent } from '../ai-types.js';
import { textAnswerSystem, textAnswerUser } from '../prompts/chat-prompts.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';
import { validateCitations } from '../citations/validate-citations.js';
import { retrieveChunks } from '../retrieval/retrieve-chunks.js';
import { groupSources, sourceBlocks } from '../retrieval/source-groups.js';
import { withQuestion } from './chat-history.js';
import {
  addUsage,
  type ChatDeps,
  type ChatInput,
  type ChatNotice,
  type PreparedChat,
} from './chat-types.js';

const ANSWER_MAX_TOKENS = 1500;

const NOT_FOUND: Record<AnswerLanguage, string> = {
  vi: 'Không tìm thấy ghi chú nào nói về điều này, nên chưa trả lời được. Bạn thử hỏi bằng từ khác nhé.',
  en: 'No note about this was found, so there is no answer yet. Try asking with other words.',
};

export async function prepareTextChat(
  input: ChatInput,
  language: AnswerLanguage,
  deps: ChatDeps,
): Promise<PreparedChat> {
  const { runtime } = deps;
  const retrieval = await retrieveChunks(input.question, {
    index: deps.index,
    vault: deps.vault,
    sources: deps.sources,
    runtime,
    notePath: input.notePath,
    signal: deps.signal,
  });
  const sources = groupSources(retrieval.chunks);
  // Raw sources of 3 Resources are out of the default scope: a match there is no news. Notes in
  // a folder left out of the scope are worth the notice.
  const scopeNotice: ChatNotice[] = retrieval.hiddenNotes > 0 ? ['out-of-scope-hidden'] : [];
  const open = () =>
    runtime.stream({
      purpose: 'chat',
      system: textAnswerSystem(language),
      messages: withQuestion(
        input.history,
        textAnswerUser(language, sourceBlocks(sources), input.question),
      ),
      maxTokens: ANSWER_MAX_TOKENS,
      temperature: 0.2,
      signal: deps.signal,
    });
  let stream: AsyncIterable<ChatStreamEvent> | null = null;
  return {
    meta: {
      kind: 'text',
      retrieval: retrieval.mode,
      sources: sources.map(({ id, path, title, page }) => ({ id, path, title, page })),
    },
    begin() {
      if (sources.length > 0) stream ??= open();
    },
    async answer(onDelta) {
      let usage = { inputTokens: 0, outputTokens: 0 };
      if (sources.length === 0) {
        onDelta(NOT_FOUND[language]);
        return {
          answer: NOT_FOUND[language],
          citations: [],
          rejected: [],
          notices: ['empty', ...scopeNotice],
          usage,
        };
      }
      let text = '';
      for await (const event of stream ?? open()) {
        if (event.type === 'delta') {
          text += event.text;
          onDelta(event.text);
        } else usage = addUsage(usage, event.usage);
      }
      const checked = validateCitations(text, {
        sources,
        allowedPaths: new Set(sources.map((source) => source.path)),
        catalog: deps.index.linkCatalog(),
        fromPath: input.notePath ?? '',
        language,
      });
      const notices: ChatNotice[] = [];
      if (checked.rejected.length > 0) notices.push('citation-rejected');
      if (checked.citations.length === 0) notices.push('uncited');
      return {
        answer: checked.answer.trim(),
        citations: checked.citations,
        rejected: checked.rejected,
        notices: [...notices, ...scopeNotice],
        usage,
      };
    },
  };
}
