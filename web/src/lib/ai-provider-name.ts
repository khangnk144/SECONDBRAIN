/**
 * The one place AI providers are named on screen (design.md §7: a name stays the same
 * everywhere): Settings, the chat, the editor actions, Inbox tidying and the consent dialogs.
 */
import type { EmbeddingProvider } from './api/ai-types';
import type { AiProvider } from './api/settings-types';

export function aiProviderName(
  provider: AiProvider | EmbeddingProvider | null | undefined,
  t: (key: string) => string,
): string {
  return t(`ai-providers.${provider ?? 'unknown'}`);
}
