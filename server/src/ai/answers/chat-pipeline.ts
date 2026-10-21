/**
 * The chat pipeline (SPEC F33): intent step → structured answer (deadline service) or text answer
 * (retrieval + citations). `prepareChat` does everything that can fail before the stream starts
 * (so those failures are plain JSON errors); `answer()` then streams.
 *
 * With nothing in scope to answer from (no user, archived, wiki or source note in scope), every
 * path ends in a fixed sentence, so the local rules classify the question and nothing is sent.
 */
import type { IndexService } from '../../index/index-types.js';
import type { ContentClass } from '../../markdown/markdown-types.js';
import type { VaultPath } from '../../vault/vault-types.js';
import type { TokenUsage } from '../ai-types.js';
import { classifyQuestion } from '../intent/classify-question.js';
import { ruleIntent } from '../intent/intent-rules.js';
import { detectLanguage } from '../prompts/answer-language.js';
import { previousQuestion } from './chat-history.js';
import { addUsage, type ChatDeps, type ChatInput, type PreparedChat } from './chat-types.js';
import { prepareStructuredChat } from './structured-chat.js';
import { prepareTextChat } from './text-chat.js';
import { topicNotes, topicTitles } from './topic-relations.js';

/** Classes that hold her own knowledge; control docs (CLAUDE.md, wiki index/log) do not count. */
const CORPUS_CLASSES = new Set<ContentClass>(['user', 'archived', 'wiki', 'source']);

export function hasCorpus(
  index: Pick<IndexService, 'listNotes'>,
  inScope: (path: VaultPath) => boolean,
): boolean {
  return index.listNotes().some((note) => CORPUS_CLASSES.has(note.class) && inScope(note.path));
}

export async function prepareChat(input: ChatInput, deps: ChatDeps): Promise<PreparedChat> {
  const language = detectLanguage(input.question, deps.uiLanguage);
  const inScope = (path: VaultPath) => deps.runtime.inScope(path);
  const topics = topicNotes(deps.index, inScope);
  const titles = topicTitles(topics);
  let intent = ruleIntent(input.question, deps.today, titles);
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  if (hasCorpus(deps.index, inScope)) {
    const classified = await classifyQuestion(input.question, {
      runtime: deps.runtime,
      today: deps.today,
      topics: titles,
      previousQuestion: previousQuestion(input.history),
      signal: deps.signal,
    });
    intent = classified.intent;
    usage = classified.usage;
  }
  const prepared =
    intent.kind === 'text'
      ? await prepareTextChat(input, language, deps)
      : prepareStructuredChat(input.question, intent, topics, language, deps);
  return {
    meta: prepared.meta,
    begin: () => prepared.begin(),
    async answer(onDelta) {
      const done = await prepared.answer(onDelta);
      return { ...done, usage: addUsage(usage, done.usage) };
    },
  };
}
