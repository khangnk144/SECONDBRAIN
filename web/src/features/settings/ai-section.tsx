import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AI_PROVIDERS, type AiProvider, type SettingsResponse } from '../../lib/api/settings-types';
import { AiFolderScope } from './ai-folder-scope';
import { SaveStatus } from './save-status';
import { SettingsField, SettingsSection } from './settings-section';
import { useSettingSave } from './use-setting-save';

type AiSettings = SettingsResponse['ai'];

/** The key is never shown again: only "…abcd" from the server; the field empties after a save. */
function ApiKeyField({ ai }: { ai: AiSettings }) {
  const { t } = useTranslation();
  const { state, save, fail } = useSettingSave();
  const [value, setValue] = useState('');
  const status = ai.keys[ai.provider];
  const providerName = t(`settings.ai.providers.${ai.provider}`);

  const submit = async () => {
    const key = value.trim();
    if (key === '') return fail(t('settings.ai.keyEmpty'));
    const saved = await save({ ai: { apiKey: { provider: ai.provider, value: key } } });
    if (saved) setValue('');
  };

  return (
    <SettingsField
      label={t('settings.ai.key', { provider: providerName })}
      htmlFor="settings-ai-key"
      status={<SaveStatus state={state} id="settings-ai-key-status" />}
      hint={
        status.set
          ? status.last4
            ? t('settings.ai.keySaved', { last4: status.last4 })
            : t('settings.ai.keySavedShort')
          : t('settings.ai.keyNone')
      }
    >
      <input
        id="settings-ai-key"
        type="password"
        className="text-input settings-input--key"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-describedby="settings-ai-key-status"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />
      <button
        type="button"
        className="button button--secondary"
        disabled={value.trim() === '' || state.kind === 'saving'}
        onClick={() => void submit()}
      >
        {t('settings.ai.keySave')}
      </button>
      {status.set ? (
        <button
          type="button"
          className="button button--secondary"
          disabled={state.kind === 'saving'}
          onClick={() => void save({ ai: { apiKey: { provider: ai.provider, value: null } } })}
        >
          {t('settings.ai.keyRemove')}
        </button>
      ) : null}
    </SettingsField>
  );
}

function ModelField({
  id,
  label,
  value,
  field,
}: {
  id: string;
  label: string;
  value: string | null;
  field: 'chatModel' | 'embeddingModel';
}) {
  const { state, save, clear } = useSettingSave();
  const stored = value ?? '';
  const [draft, setDraft] = useState(stored);
  useLayoutEffect(() => setDraft(stored), [stored]);
  const commit = () => {
    if (draft.trim() === stored) return;
    void save({ ai: { [field]: draft.trim() === '' ? null : draft.trim() } });
  };
  return (
    <SettingsField label={label} htmlFor={id} status={<SaveStatus state={state} />}>
      <input
        id={id}
        className="text-input settings-input--model"
        value={draft}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') {
            setDraft(stored);
            clear();
          }
        }}
      />
    </SettingsField>
  );
}

/**
 * "AI" (Phase 3 arrives later; the copy says so): provider, API key, models and the folders AI
 * may read are stored now, and nothing is sent anywhere.
 */
export function AiSection({ ai }: { ai: AiSettings }) {
  const { t } = useTranslation();
  const provider = useSettingSave();
  return (
    <SettingsSection id="ai" title={t('settings.ai.title')} intro={t('settings.ai.intro')}>
      <SettingsField
        label={t('settings.ai.provider')}
        htmlFor="settings-ai-provider"
        status={<SaveStatus state={provider.state} />}
      >
        <select
          id="settings-ai-provider"
          className="text-input settings-select"
          value={ai.provider}
          onChange={(event) =>
            void provider.save({ ai: { provider: event.target.value as AiProvider } })
          }
        >
          {AI_PROVIDERS.map((value) => (
            <option key={value} value={value}>
              {t(`settings.ai.providers.${value}`)}
            </option>
          ))}
        </select>
      </SettingsField>
      <ApiKeyField ai={ai} />
      <ModelField
        id="settings-ai-chat-model"
        label={t('settings.ai.chatModel')}
        value={ai.chatModel}
        field="chatModel"
      />
      <ModelField
        id="settings-ai-embedding-model"
        label={t('settings.ai.embeddingModel')}
        value={ai.embeddingModel}
        field="embeddingModel"
      />
      <AiFolderScope folders={ai.folders} />
    </SettingsSection>
  );
}
