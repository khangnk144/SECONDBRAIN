/**
 * Default models, in one place so they are easy to change when providers retire a model. The
 * settings' `chatModel` / `embeddingModel` override them.
 */
import type { AiSettings } from '../../config/settings-sections.js';
import type { AiProvider, EmbeddingProvider } from '../ai-types.js';

export const DEFAULT_CHAT_MODELS: Readonly<Record<AiProvider, string>> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-5-mini',
  // Gemini 2.5 models are limited to existing users; new projects get the 3.x line.
  gemini: 'gemini-3.5-flash-lite',
};

/** Embedding model and the vector size requested from it (smaller vectors, smaller store). */
export const DEFAULT_EMBEDDING_MODELS: Readonly<
  Record<EmbeddingProvider, { model: string; dims: number }>
> = {
  openai: { model: 'text-embedding-3-small', dims: 512 },
  gemini: { model: 'gemini-embedding-001', dims: 768 },
};

export function chatModelOf(ai: AiSettings): string {
  return ai.chatModel ?? DEFAULT_CHAT_MODELS[ai.provider];
}

/** Model and dimensions the embedding store is built with; a change of either means a rebuild. */
export function embeddingConfigOf(ai: AiSettings): {
  provider: EmbeddingProvider;
  model: string;
  dims: number;
} {
  const defaults = DEFAULT_EMBEDDING_MODELS[ai.embeddingProvider];
  return {
    provider: ai.embeddingProvider,
    model: ai.embeddingModel ?? defaults.model,
    dims: defaults.dims,
  };
}
