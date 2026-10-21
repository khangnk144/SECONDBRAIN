/**
 * Contract between the AI platform (AP: providers, settings, budget, embeddings – the per-vault
 * plugin `AI_PLUGIN`) and the AI answers layer (AQ: intent, retrieval, citations, chat/action
 * routes). Written by the lead before M6 (SPEC F33); extend, never rename.
 */
import type { VaultPluginInstance } from '../app-context/vault-plugins.js';
import type { AiProvider } from '../config/settings-sections.js';
import type { VaultPath } from '../vault/vault-types.js';

export type { AiProvider } from '../config/settings-sections.js';

/** Anthropic has no embeddings API: embeddings use OpenAI or Gemini (their own key). */
export type EmbeddingProvider = 'openai' | 'gemini';

/** What a request is for (usage accounting, logs, which guard applies). */
export type AiPurpose = 'chat' | 'intent' | 'action' | 'today' | 'search' | 'embed';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  purpose: Exclude<AiPurpose, 'embed'>;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Ask for one JSON object as the whole answer (provider JSON mode where it exists). */
  json?: boolean;
  signal?: AbortSignal;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type ChatStreamEvent =
  { type: 'delta'; text: string } | { type: 'done'; usage: TokenUsage; stopReason: string | null };

/** Codes the routes turn into `{ error: { code } }` (SPEC §9 plus M6 additions). */
export type AiErrorCode =
  /** 409: AI is off, or on without the recorded consent. */
  | 'AI_DISABLED'
  /** 409: no API key for the provider that is needed. */
  | 'AI_NO_KEY'
  /** 429: the monthly token limit is reached; calls are paused until next month or a higher limit. */
  | 'AI_BUDGET'
  /** 502: the provider failed (network, 4xx/5xx, timeout, malformed stream). `details.reason`. */
  | 'AI_PROVIDER_ERROR';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export const AI_ERROR_STATUS: Readonly<Record<AiErrorCode, number>> = {
  AI_DISABLED: 409,
  AI_NO_KEY: 409,
  AI_BUDGET: 429,
  AI_PROVIDER_ERROR: 502,
};

export type EmbeddingState = 'off' | 'idle' | 'queued' | 'running' | 'stale' | 'error';

/** `GET /api/ai/status`. Never contains a key. */
export interface AiStatus {
  /** The AI plugin runs for the open vault. */
  available: boolean;
  enabled: boolean;
  consented: boolean;
  provider: AiProvider;
  hasKey: boolean;
  /** Effective chat model (setting or the provider default). */
  chatModel: string;
  /** enabled && consented && hasKey && !usage.paused. */
  ready: boolean;
  reason: null | 'disabled' | 'no-consent' | 'no-key' | 'budget';
  /** What text questions and the palette use. */
  retrieval: 'bm25' | 'hybrid';
  embeddings: {
    enabled: boolean;
    consented: boolean;
    provider: EmbeddingProvider;
    model: string;
    hasKey: boolean;
    state: EmbeddingState;
    /** Chunks embedded / to embed in the current pass (rebuild progress). */
    done: number;
    total: number;
    /** Notes waiting for their 5-minute quiet period or a retry. */
    pending: number;
    /** Error code of the last failure (never a message from the provider). */
    lastError: string | null;
  };
  usage: { month: string; tokens: number; limit: number; paused: boolean };
  /** Top-level vault folders AI may read ('' = root-level notes). */
  scope: string[];
}

/** A slice of a note or source used as retrieval unit (embeddings and BM25 chunks alike). */
export interface NoteChunk {
  /** 0-based position in the note. */
  index: number;
  /** 1-based inclusive line range in the file (pages for PDFs: see `page`). */
  startLine: number;
  endLine: number;
  /** Nearest heading above the chunk, without `#`. */
  heading: string | null;
  /** PDF page number when the chunk comes from a source's page. */
  page?: number;
  text: string;
}

export interface EmbeddingHit {
  path: VaultPath;
  chunk: NoteChunk;
  /** Cosine similarity, -1..1. */
  score: number;
}

export interface EmbeddingIndex {
  /** True when every in-scope note has vectors for the current model (no rebuild pending). */
  isReady(): boolean;
  /** Embeds the query (network, counts usage, budget-checked) and returns the nearest chunks in scope. */
  query(text: string, k: number, signal?: AbortSignal): Promise<EmbeddingHit[]>;
}

/** Per-vault plugin `AI_PLUGIN` (AP). The only module that talks to providers. */
export interface AiRuntime extends VaultPluginInstance {
  status(): AiStatus;
  /** Throws AiError when AI cannot be used now (off, no consent, no key, budget). No network. */
  assertReady(purpose: AiPurpose): void;
  /** Streams one completion with the configured provider and model; checks the budget first and records usage. */
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
  /** The whole answer of one completion (same rules as `stream`). */
  complete(request: ChatRequest): Promise<{ text: string; usage: TokenUsage }>;
  /** Whether the content of this vault path may be sent to a provider (folder scope, classes). */
  inScope(path: VaultPath): boolean;
  /** Embedding search when embeddings are on, consented, keyed and ready; else null. */
  embeddings(): EmbeddingIndex | null;
  /** Starts a full re-embedding (model change, user request). False when off or already running. */
  rebuildEmbeddings(): boolean;
  /**
   * AP extension: `PUT /api/settings` calls it after a change of `ai` or `mcp`. The runtime
   * re-evaluates at once (embedding jobs start, stop or drop out-of-scope notes) and broadcasts
   * `ai:status`. Optional so test doubles need not implement it.
   */
  settingsChanged?(): void;
}
