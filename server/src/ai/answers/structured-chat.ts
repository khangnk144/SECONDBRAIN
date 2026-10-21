/**
 * Deadline and task questions (SPEC F33.1, S5): the items come from the deadline service and the
 * server renders the whole list; the model only writes a short introduction from the counts.
 * Zero items → a fixed sentence and no model call (notice `no-items`). A topic none of the open
 * items belongs to → a fixed sentence saying so, then every item of the range (no model call).
 * If the introduction call fails, the list is still answered (the model only phrases; it never
 * decides what is listed).
 */
import { AiError, type ChatStreamEvent } from '../ai-types.js';
import { validateCitations, type Citation } from '../citations/validate-citations.js';
import type { QuestionIntent } from '../intent/intent-types.js';
import { type AnswerLanguage } from '../prompts/answer-language.js';
import { deadlineIntroSystem } from '../prompts/chat-prompts.js';
import { dataBlock } from '../prompts/data-blocks.js';
import {
  addUsage,
  type ChatDeps,
  type ChatDone,
  type ChatNotice,
  type PreparedChat,
} from './chat-types.js';
import { selectStructuredItems } from './structured-items.js';
import {
  hiddenSentence,
  introFacts,
  noItemsSentence,
  renderStructuredList,
  unmatchedTopicSentence,
} from './structured-render.js';
import { topicPathsFor, topicRelation, type TopicNote } from './topic-relations.js';

const INTRO_MAX_TOKENS = 200;

export function prepareStructuredChat(
  question: string,
  intent: QuestionIntent,
  topics: readonly TopicNote[],
  language: AnswerLanguage,
  deps: ChatDeps,
): PreparedChat {
  const { runtime, today } = deps;
  const answer = selectStructuredItems(intent, {
    deadlines: deps.deadlines,
    today,
    inScope: (path) => runtime.inScope(path),
    relatesToTopics:
      intent.about.length > 0
        ? topicRelation(deps.index, topicPathsFor(intent.about, topics), intent.about)
        : null,
  });
  // `no-items`: nothing to keep, so the web offers no "Lưu thành ghi chú" for it.
  const notices: ChatNotice[] = answer.total === 0 ? ['no-items'] : [];
  if (answer.hidden > 0) notices.push('out-of-scope-hidden');
  // Nothing linked to the topic: a fixed sentence and the whole list, no introduction (a model
  // phrasing "your Probability items" over unrelated items would mislead).
  const fixedOpening = answer.aboutUnmatched ? unmatchedTopicSentence(answer, language) : null;
  const hidden = answer.hidden > 0 ? `\n\n${hiddenSentence(answer.hidden, language)}` : '';
  const citations: Citation[] = [];
  const seen = new Set<string>();
  for (const entry of answer.groups.flatMap((group) => group.entries)) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    citations.push({ path: entry.path, title: entry.noteTitle, page: null });
  }

  // Whether the introduction can be written: a refusal of the runtime (budget…) or a provider
  // failure only drops the introduction, never the list.
  let stream: AsyncIterable<ChatStreamEvent> | null = null;
  let opened = false;
  const begin = () => {
    if (opened || answer.total === 0 || fixedOpening !== null) return;
    opened = true;
    try {
      stream = runtime.stream({
        purpose: 'chat',
        system: deadlineIntroSystem(language),
        messages: [
          {
            role: 'user',
            content: `${dataBlock('question', question)}\n\n${introFacts(answer, today, language)}`,
          },
        ],
        maxTokens: INTRO_MAX_TOKENS,
        temperature: 0.3,
        signal: deps.signal,
      });
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
    }
  };

  return {
    meta: { kind: intent.kind, retrieval: 'structured', sources: [] },
    begin,
    async answer(onDelta): Promise<ChatDone> {
      let usage = { inputTokens: 0, outputTokens: 0 };
      if (answer.total === 0) {
        const text = `${noItemsSentence(answer, today, language)}${hidden}`;
        onDelta(text);
        return { answer: text, citations: [], rejected: [], notices, usage };
      }
      if (fixedOpening !== null) {
        const text = `${fixedOpening}\n\n${renderStructuredList(answer, today, language)}${hidden}`;
        onDelta(text);
        return { answer: text, citations, rejected: [], notices, usage };
      }
      begin();
      let intro = '';
      try {
        for await (const event of stream ?? []) {
          if (event.type === 'delta') {
            intro += event.text;
            onDelta(event.text);
          } else usage = addUsage(usage, event.usage);
        }
      } catch (error) {
        if (deps.signal.aborted || !(error instanceof AiError)) throw error;
      }
      const list = renderStructuredList(answer, today, language);
      const tail = `${intro.trim() === '' ? '' : '\n\n'}${list}${hidden}`;
      onDelta(tail);
      // The introduction may not link anywhere but to the listed notes.
      const checked = validateCitations(intro, {
        sources: [],
        allowedPaths: seen,
        catalog: deps.index.linkCatalog(),
        fromPath: '',
        language,
      });
      if (checked.rejected.length > 0) notices.unshift('citation-rejected');
      const opening = checked.answer.trim();
      return {
        answer: `${opening}${opening === '' ? '' : '\n\n'}${list}${hidden}`,
        citations,
        rejected: checked.rejected,
        notices,
        usage,
      };
    },
  };
}
