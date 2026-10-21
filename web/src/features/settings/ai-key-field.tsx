import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { AiProvider, ApiKeyStatus } from '../../lib/api/settings-types';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';
import { useSettingSave } from './use-setting-save';

/**
 * One provider's API key. The key is never shown again: only "…abcd" from the server; the field
 * empties after a save, and it is saved only on Enter or "Lưu khóa".
 */
export function ApiKeyField({
  id,
  provider,
  status,
}: {
  id: string;
  provider: AiProvider;
  status: ApiKeyStatus;
}) {
  const { t } = useTranslation();
  const { state, save, fail } = useSettingSave();
  const [value, setValue] = useState('');
  const providerName = aiProviderName(provider, t);
  const statusId = `${id}-status`;

  const submit = async () => {
    const key = value.trim();
    if (key === '') return fail(t('settings.ai.keyEmpty'));
    const saved = await save({ ai: { apiKey: { provider, value: key } } });
    if (saved) setValue('');
  };

  return (
    <SettingsField
      label={t('settings.ai.key', { provider: providerName })}
      htmlFor={id}
      status={<SaveStatus state={state} id={statusId} />}
      hint={
        status.set
          ? status.last4
            ? t('settings.ai.keySaved', { last4: status.last4 })
            : t('settings.ai.keySavedShort')
          : t('settings.ai.keyNone')
      }
    >
      <input
        id={id}
        type="password"
        className="text-input settings-input--key"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={statusId}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />
      <button
        type="button"
        className="button button--secondary"
        disabled={value.trim() === '' || state.kind === 'saving'}
        aria-label={t('settings.ai.keySaveNamed', { provider: providerName })}
        onClick={() => void submit()}
      >
        {t('settings.ai.keySave')}
      </button>
      {status.set ? (
        <button
          type="button"
          className="button button--secondary"
          disabled={state.kind === 'saving'}
          aria-label={t('settings.ai.keyRemoveNamed', { provider: providerName })}
          onClick={() => void save({ ai: { apiKey: { provider, value: null } } })}
        >
          {t('settings.ai.keyRemove')}
        </button>
      ) : null}
    </SettingsField>
  );
}
