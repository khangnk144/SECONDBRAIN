import { useTranslation } from 'react-i18next';
import { i18n } from '../../i18n';
import { aiProviderName } from '../../lib/ai-provider-name';
import { rebuildEmbeddings } from '../../lib/api/ai-api';
import { isApiError } from '../../lib/api-client';
import type { EmbeddingProvider } from '../../lib/api/ai-types';
import { ActionMessage } from './action-message';
import { settingsSaveError } from './settings-errors';
import { useActionStatus } from './use-action-status';

const REBUILD = 'settings.ai.embeddings.rebuildErrors';

/** Why `POST /ai/embeddings/rebuild` was refused, in words (409/429/503 from the AI routes). */
export function rebuildError(error: unknown, provider: string): string {
  if (isApiError(error)) {
    if (error.code === 'AI_NO_KEY') return i18n.t(`${REBUILD}.no-key`, { provider });
    if (error.code === 'AI_BUDGET') return i18n.t(`${REBUILD}.budget`);
    if (error.code === 'UNAVAILABLE') return i18n.t(`${REBUILD}.unavailable`);
    if (error.code === 'AI_DISABLED') {
      return error.details.reason === 'no-consent'
        ? i18n.t(`${REBUILD}.no-consent`)
        : i18n.t(`${REBUILD}.disabled`);
    }
  }
  return settingsSaveError(error);
}

/**
 * "Tạo lại chỉ mục theo nghĩa": starts a full pass (202); its progress then shows in the state
 * line above through `ai:status`.
 */
export function EmbeddingsRebuildRow({ provider }: { provider: EmbeddingProvider }) {
  const { t } = useTranslation();
  const { state, run } = useActionStatus();
  const providerName = aiProviderName(provider, t);
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={state.kind === 'busy' || undefined}
          aria-describedby="settings-ai-rebuild-hint"
          onClick={() =>
            void run(
              async () => {
                const { started } = await rebuildEmbeddings();
                return started
                  ? t('settings.ai.embeddings.rebuildStarted')
                  : t('settings.ai.embeddings.rebuildRunning');
              },
              (error) => rebuildError(error, providerName),
            )
          }
        >
          {t('settings.ai.embeddings.rebuild')}
        </button>
      </div>
      <p id="settings-ai-rebuild-hint" className="settings-field__hint">
        {t('settings.ai.embeddings.rebuildHint')}
      </p>
      <ActionMessage state={state} />
    </div>
  );
}
