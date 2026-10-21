import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { AI_PROVIDERS, type AiProvider, type SettingsResponse } from '../../lib/api/settings-types';
import { AiBudgetField } from './ai-budget-field';
import { AiEmbeddingsSection } from './ai-embeddings-section';
import { AiEnableControls } from './ai-enable-controls';
import { AiFolderScope } from './ai-folder-scope';
import { ApiKeyField } from './ai-key-field';
import { AiModelField } from './ai-model-field';
import { SaveStatus } from './save-status';
import { SettingsField, SettingsSection } from './settings-section';
import { useSettingSave } from './use-setting-save';

type AiSettings = SettingsResponse['ai'];

/** A provider change while AI is on needs a new consent (the status line then asks for it). */
function ProviderField({ ai }: { ai: AiSettings }) {
  const { t } = useTranslation();
  const { state, save } = useSettingSave();
  return (
    <SettingsField
      label={t('settings.ai.provider')}
      htmlFor="settings-ai-provider"
      status={<SaveStatus state={state} />}
    >
      <select
        id="settings-ai-provider"
        className="text-input settings-select"
        value={ai.provider}
        onChange={(event) => void save({ ai: { provider: event.target.value as AiProvider } })}
      >
        {AI_PROVIDERS.map((value) => (
          <option key={value} value={value}>
            {aiProviderName(value, t)}
          </option>
        ))}
      </select>
    </SettingsField>
  );
}

/**
 * "AI" (route B, SPEC F18, F33): what AI does now, the switch behind a consent dialog, provider,
 * key, model, the folders it may read, the monthly limit and, separately, search by meaning.
 * What is true right now comes from `GET /api/ai/status` (the shared status store).
 */
export function AiSection({ ai }: { ai: AiSettings }) {
  const { t } = useTranslation();
  const status = useAiStatusStore((state) => state.status);
  const chatDefault =
    ai.chatModel === null && status?.provider === ai.provider ? status.chatModel : null;
  return (
    <SettingsSection
      id="ai"
      title={t('settings.ai.title')}
      intro={
        <>
          {t('settings.ai.intro')} {t('settings.ai.subscriptionNote')}
        </>
      }
    >
      <AiEnableControls ai={ai} status={status} />
      <ProviderField ai={ai} />
      <ApiKeyField id="settings-ai-key" provider={ai.provider} status={ai.keys[ai.provider]} />
      <AiModelField
        id="settings-ai-chat-model"
        label={t('settings.ai.chatModel')}
        value={ai.chatModel}
        field="chatModel"
        defaultModel={chatDefault}
      />
      <AiFolderScope folders={ai.folders} />
      <AiBudgetField limit={ai.monthlyTokenLimit} status={status} />
      <AiEmbeddingsSection ai={ai} status={status} />
    </SettingsSection>
  );
}
