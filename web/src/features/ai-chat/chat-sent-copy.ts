/**
 * What a question sends and to whom, said where she asks (plan rule: AI copy says what is sent
 * where). In hybrid mode the question is also turned into a vector by the embedding provider.
 */
import type { TFunction } from 'i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { AiStatus } from '../../lib/api/ai-types';

export function chatSentCopy(status: AiStatus, t: TFunction): string {
  const sent = t('ai-chat.sent', { provider: aiProviderName(status.provider, t) });
  if (status.retrieval !== 'hybrid') return sent;
  const meaning = t('ai-chat.sentHybrid', {
    provider: aiProviderName(status.embeddings.provider, t),
  });
  return `${sent} ${meaning}`;
}
