import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { AiStatus } from '../../lib/api/ai-types';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { embeddingsLine, progressFromEvent, type EmbeddingsProgress } from './embeddings-state';

/**
 * The index's state under "Tìm theo nghĩa". Progress follows `ai:status` events at once (the
 * status store refetches on the same event; its next answer replaces the event's numbers).
 */
export function EmbeddingsStateLine({
  ai,
  status,
  onReviewConsent,
}: {
  ai: SettingsResponse['ai'];
  status: AiStatus | null;
  onReviewConsent: () => void;
}) {
  const { t } = useTranslation();
  const [live, setLive] = useState<EmbeddingsProgress | null>(null);
  useServerEvent('ai:status', (event) => setLive(progressFromEvent(event.embeddings)));
  useEffect(() => setLive(null), [status]);
  const line = embeddingsLine(ai, status, live);
  if (line === null) return null;
  const provider = aiProviderName(ai.embeddingProvider, t);
  const base = 'settings.ai.embeddings';
  let text: string;
  switch (line.key) {
    case 'running':
      text =
        line.total > 0
          ? t(`${base}.state.running`, { done: line.done, total: line.total })
          : t(`${base}.state.runningStart`);
      break;
    case 'error':
    case 'retrying':
      text = t(`${base}.state.${line.key}`, {
        message: t(`${base}.errors.${line.error}`, { provider }),
      });
      break;
    default:
      text = t(`${base}.state.${line.key}`, { provider });
  }
  const notice = !['off', 'idle', 'running', 'queued'].includes(line.key);
  return (
    <div className="settings-field">
      <p
        className={notice ? 'settings-ai-status settings-field__notice' : 'settings-ai-status'}
        role="status"
      >
        {text}
      </p>
      {line.key === 'running' && line.total > 0 ? (
        <progress
          className="settings-progress__bar settings-ai-progress"
          aria-label={t(`${base}.progressLabel`)}
          max={line.total}
          value={line.done}
        />
      ) : null}
      {'consent' in line ? (
        <div className="settings-field__control">
          <button type="button" className="button button--secondary" onClick={onReviewConsent}>
            {t('settings.ai.reviewConsent')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
