/** Shapes of `POST /api/ai/action` and the dependencies of the editor actions (SPEC F33, R1). */
import type { IndexService } from '../../index/index-types.js';
import type { SourceTextService } from '../../sources/source-types.js';
import type { VaultPath, VaultService } from '../../vault/vault-types.js';
import { AiError, type AiRuntime } from '../ai-types.js';
import type { ChatIndex } from '../answers/chat-types.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';

export type ActionName =
  'summarize' | 'improve' | 'explain' | 'suggest-links' | 'suggest-tags' | 'suggest-placement';

export interface ActionDeps {
  runtime: AiRuntime;
  index: ChatIndex & Pick<IndexService, 'noteTags'>;
  vault: Pick<VaultService, 'read' | 'list'>;
  sources: Pick<SourceTextService, 'read'> | null;
  uiLanguage: AnswerLanguage;
  signal: AbortSignal;
}

export interface LinkSuggestion {
  path: VaultPath;
  title: string;
  reason: string;
}

export interface TagSuggestion {
  tag: string;
  /** The vault already uses this tag (her spelling is returned). */
  existing: boolean;
}

export interface PlacementProposal {
  current: { folder: string; title: string };
  folder: string;
  title: string;
  reason: string;
  /** True when the model proposes leaving the note where it is (folder and title unchanged). */
  keep: boolean;
}

/** The model's reply could not be used: the same 502 the provider layer uses for bad streams. */
export function unusableReply(reason: 'malformed' | 'invalid-answer'): AiError {
  return new AiError('AI_PROVIDER_ERROR', 'The AI answer could not be used. Try again.', {
    reason,
  });
}

/** Plain one-line reason from the model, at most 200 characters. */
export function cleanReason(value: unknown): string {
  if (typeof value !== 'string') return '';
  const line = value.replace(/\s+/g, ' ').trim();
  return [...line].length > 200 ? `${[...line].slice(0, 199).join('')}…` : line;
}

/** Characters of a selection used as the retrieval query (long texts would dilute it). */
export const QUERY_CHARS = 2000;
/** Characters of a selection or note sent with a suggestion prompt. */
export const PROMPT_TEXT_CHARS = 8000;
