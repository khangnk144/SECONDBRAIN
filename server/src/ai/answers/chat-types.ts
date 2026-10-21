/** Shapes of `POST /api/ai/chat` (SSE events) and the dependencies of the chat pipeline. */
import type { DeadlineService, IndexService } from '../../index/index-types.js';
import type { SourceTextService } from '../../sources/source-types.js';
import type { VaultPath, VaultService } from '../../vault/vault-types.js';
import type { AiRuntime, ChatMessage, TokenUsage } from '../ai-types.js';
import type { Citation } from '../citations/validate-citations.js';
import type { QuestionKind } from '../intent/intent-types.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';
import type { RetrievalIndex } from '../retrieval/retrieval-types.js';

/**
 * `out-of-scope-hidden`: deadline items were left out (structured), or notes matching a text
 * question sit in folders outside the scope (not raw sources of `3 Resources`, which are out by
 * default). `no-items`: a structured answer listing nothing (nothing to save as a note).
 */
export type ChatNotice =
  'citation-rejected' | 'uncited' | 'empty' | 'out-of-scope-hidden' | 'no-items';

/** `event: meta`, sent first. */
export interface ChatMeta {
  kind: QuestionKind;
  retrieval: 'structured' | 'bm25' | 'hybrid';
  sources: { id: string; path: VaultPath; title: string; page: number | null }[];
}

/** `event: done`, sent last on success. */
export interface ChatDone {
  answer: string;
  citations: Citation[];
  rejected: string[];
  notices: ChatNotice[];
  usage: TokenUsage;
}

export interface ChatInput {
  question: string;
  history: ChatMessage[];
  notePath: VaultPath | null;
}

export type ChatIndex = Pick<IndexService, 'getNote' | 'listNotes' | 'outlinks' | 'linkCatalog'> &
  RetrievalIndex;

export interface ChatDeps {
  runtime: AiRuntime;
  index: ChatIndex;
  deadlines: Pick<DeadlineService, 'items' | 'today'>;
  vault: Pick<VaultService, 'read'>;
  sources: Pick<SourceTextService, 'read'> | null;
  /** Local calendar date. */
  today: string;
  uiLanguage: AnswerLanguage;
  signal: AbortSignal;
}

/** Intent and retrieval are done (errors so far are plain JSON errors); the answer is next. */
export interface PreparedChat {
  meta: ChatMeta;
  /**
   * Opens the model stream, if the answer needs one. The runtime checks readiness and budget
   * synchronously here, so a refusal is still a plain JSON error (called before the SSE starts).
   */
  begin(): void;
  /** Streams the answer through `onDelta` and resolves with the validated result. */
  answer(onDelta: (text: string) => void): Promise<ChatDone>;
}

export const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
});
