import type { AiProvider, EmbeddingProvider } from '../ai-types.js';
import { anthropicProvider } from './anthropic-provider.js';
import { geminiProvider } from './gemini-provider.js';
import { openAiProvider } from './openai-provider.js';
import type { ChatProviderModule, EmbedProviderModule } from './provider-types.js';

export const CHAT_PROVIDERS: Readonly<Record<AiProvider, ChatProviderModule>> = {
  anthropic: anthropicProvider,
  openai: openAiProvider,
  gemini: geminiProvider,
};

export const EMBED_PROVIDERS: Readonly<Record<EmbeddingProvider, EmbedProviderModule>> = {
  openai: openAiProvider,
  gemini: geminiProvider,
};
