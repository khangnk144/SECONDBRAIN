/**
 * In-app AI routes (SPEC F33, F30 search additions), mirrored by hand from `server/src/ai/ai-types.ts`
 * and `server/src/api/ai-routes.ts`. Written by the lead for M6; extend, never rename.
 */
import type { AiProvider } from './settings-types';
import type { VaultPath } from './vault-types';

export type EmbeddingProvider = 'openai' | 'gemini';
export type EmbeddingState = 'off' | 'idle' | 'queued' | 'running' | 'stale' | 'error';
export type AiNotReadyReason = 'disabled' | 'no-consent' | 'no-key' | 'budget';

/** `GET /api/ai/status`. */
export interface AiStatus {
  available: boolean;
  enabled: boolean;
  consented: boolean;
  provider: AiProvider;
  hasKey: boolean;
  chatModel: string;
  ready: boolean;
  reason: AiNotReadyReason | null;
  retrieval: 'bm25' | 'hybrid';
  embeddings: {
    enabled: boolean;
    consented: boolean;
    provider: EmbeddingProvider;
    model: string;
    hasKey: boolean;
    state: EmbeddingState;
    done: number;
    total: number;
    pending: number;
    lastError: string | null;
  };
  usage: { month: string; tokens: number; limit: number; paused: boolean };
  /** Top-level folders AI may read ('' = root-level notes). */
  scope: string[];
}

export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  question: string;
  history?: ChatHistoryMessage[];
  notePath?: VaultPath;
}

export type AiChatKind = 'deadlines' | 'tasks' | 'text';

export interface AiChatSource {
  id: string;
  path: VaultPath;
  title: string;
  page: number | null;
}

/** `no-items`: a deadline/task answer with nothing in the range (the server's own sentence). */
export type AiChatNotice =
  'citation-rejected' | 'uncited' | 'empty' | 'no-items' | 'out-of-scope-hidden' | (string & {});

/** Server-sent events of `POST /api/ai/chat`, in order: meta, delta*, done | error. */
export type AiChatEvent =
  | {
      type: 'meta';
      kind: AiChatKind;
      retrieval: 'structured' | 'bm25' | 'hybrid';
      sources: AiChatSource[];
    }
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      /** Validated Markdown: links are `[[path|title]]` to notes of the retrieved set only. */
      answer: string;
      /** `page` is set for a PDF page cited by a text answer (AQ report). */
      citations: { path: VaultPath; title: string; page: number | null }[];
      rejected: string[];
      notices: AiChatNotice[];
      usage: { inputTokens: number; outputTokens: number };
    }
  | { type: 'error'; code: string; message: string; details?: Record<string, unknown> };

export type AiTextAction = 'summarize' | 'improve' | 'explain';

export type AiActionRequest =
  | { action: AiTextAction; text: string; path?: VaultPath }
  | { action: 'suggest-links'; text: string; path?: VaultPath }
  | { action: 'suggest-tags'; text: string; path?: VaultPath }
  | { action: 'suggest-placement'; path: VaultPath };

export interface AiTextActionResponse {
  action: AiTextAction;
  text: string;
}
export interface AiLinkSuggestions {
  links: { path: VaultPath; title: string; reason: string }[];
}
export interface AiTagSuggestions {
  tags: { tag: string; existing: boolean }[];
}
export interface AiPlacementSuggestion {
  current: { folder: string; title: string };
  folder: string;
  title: string;
  reason: string;
  keep: boolean;
}

export interface AiTodaySummary {
  date: string;
  text: string | null;
}

export interface AiSearchResult {
  path: VaultPath;
  title: string;
  snippet: string | null;
  page: number | null;
  score: number;
}

export interface AiSearchResponse {
  mode: 'hybrid' | 'bm25';
  results: AiSearchResult[];
}
