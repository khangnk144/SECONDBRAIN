import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { AiStatus, EmbeddingProvider } from '../../lib/api/ai-types';
import { EMBEDDING_PROVIDERS, type SettingsResponse } from '../../lib/api/settings-types';
import { EmbeddingsConsentDialog } from './ai-consent-dialogs';
import { ApiKeyField } from './ai-key-field';
import { AiModelField } from './ai-model-field';
import { EmbeddingsRebuildRow } from './embeddings-rebuild-row';
import { EmbeddingsStateLine } from './embeddings-state-line';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';
import { useSettingSave } from './use-setting-save';

type AiSettings = SettingsResponse['ai'];

/** Embedding provider: a change resets the model to that provider's default (server rule). */
function EmbeddingProviderField({ ai }: { ai: AiSettings }) {
  const { t } = useTranslation();
  const { state, save } = useSettingSave();
  return (
    <SettingsField
      label={t('settings.ai.embeddings.provider')}
      htmlFor="settings-ai-embedding-provider"
      status={<SaveStatus state={state} />}
    >
      <select
        id="settings-ai-embedding-provider"
        className="text-input settings-select"
        value={ai.embeddingProvider}
        onChange={(event) =>
          void save({ ai: { embeddingProvider: event.target.value as EmbeddingProvider } })
        }
      >
        {EMBEDDING_PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {aiProviderName(value, t)}
          </option>
        ))}
      </select>
    </SettingsField>
  );
}

/**
 * "Tìm theo nghĩa (embeddings)": a separate opt-in with its own consent dialog (SPEC F33: saving
 * a key never turns it on), its provider, key and model, the index state and a rebuild.
 */
export function AiEmbeddingsSection({ ai, status }: { ai: AiSettings; status: AiStatus | null }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const { state, save, clear } = useSettingSave();
  const agree = async () => {
    const saved = await save({ ai: { embeddings: true, embeddingsConsent: true } });
    if (saved) setAsking(false);
  };
  const shared = ai.embeddingProvider === ai.provider;
  const sameProviderStatus = status?.embeddings.provider === ai.embeddingProvider;
  return (
    <section className="settings-subsection" aria-labelledby="settings-ai-embeddings">
      <h3 id="settings-ai-embeddings" className="settings-subsection__title">
        {t('settings.ai.embeddings.title')}
      </h3>
      <p className="settings-section__intro settings-subsection__intro">
        {t('settings.ai.embeddings.intro')}
      </p>
      <EmbeddingsStateLine ai={ai} status={status} onReviewConsent={() => setAsking(true)} />
      <div className="settings-field">
        <div className="settings-field__control">
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              checked={ai.embeddings}
              onChange={(event) => {
                if (state.kind === 'saving') return;
                if (event.target.checked) {
                  clear();
                  setAsking(true);
                } else {
                  void save({ ai: { embeddings: false } });
                }
              }}
            />
            <span>{t('settings.ai.embeddings.enable')}</span>
          </label>
          {asking ? null : <SaveStatus state={state} />}
        </div>
      </div>
      <EmbeddingProviderField ai={ai} />
      {shared ? (
        <p className="settings-field__hint">
          {t('settings.ai.keyShared', {
            provider: aiProviderName(ai.embeddingProvider, t),
          })}
        </p>
      ) : (
        <ApiKeyField
          id="settings-ai-embedding-key"
          provider={ai.embeddingProvider}
          status={ai.keys[ai.embeddingProvider]}
        />
      )}
      <AiModelField
        id="settings-ai-embedding-model"
        label={t('settings.ai.embeddings.model')}
        value={ai.embeddingModel}
        field="embeddingModel"
        defaultModel={
          ai.embeddingModel === null && sameProviderStatus && status
            ? status.embeddings.model
            : null
        }
      />
      {ai.embeddings ? <EmbeddingsRebuildRow provider={ai.embeddingProvider} /> : null}
      {asking ? (
        <EmbeddingsConsentDialog
          ai={ai}
          state={state}
          onAgree={() => void agree()}
          onLater={() => {
            clear();
            setAsking(false);
          }}
        />
      ) : null}
    </section>
  );
}
