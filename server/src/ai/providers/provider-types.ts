/**
 * Shapes shared by the provider modules (Anthropic, OpenAI, Gemini). Providers talk HTTP through
 * the global `fetch` only (no SDKs); the runtime injects it, so tests never reach a network.
 */
import type { ChatRequest, ChatStreamEvent, TokenUsage } from '../ai-types.js';

/** The part of `fetch` the providers use (tests pass a recording fake). */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** One-shot timers, injectable so tests can fire the 30 s / 120 s timeouts by hand. */
export interface ProviderTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Everything one provider request needs besides its payload. */
export interface ProviderCall {
  /** `https://api.anthropic.com` etc., without a trailing slash (see provider-endpoints.ts). */
  baseUrl: string;
  model: string;
  key: string;
  fetch: FetchLike;
  /** The caller's cancellation (client disconnect, embeddings switched off). */
  signal?: AbortSignal;
  timers?: ProviderTimers;
}

export interface ChatProviderModule {
  streamChat(call: ProviderCall, request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface EmbedResult {
  /** One vector per input text, in input order. */
  vectors: Float32Array[];
  usage: TokenUsage;
}

export interface EmbedProviderModule {
  embed(call: ProviderCall, texts: readonly string[], dims: number): Promise<EmbedResult>;
}

/**
 * `details.reason` of `AI_PROVIDER_ERROR`. `aborted` (an extension) = the caller cancelled; it is
 * not a failure of the provider and is never retried by the embedding jobs.
 */
export type ProviderErrorReason =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'quota'
  | 'bad-request'
  | 'server'
  | 'malformed'
  | 'aborted';
