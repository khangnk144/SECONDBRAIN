import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';
import { useSettingSave } from './use-setting-save';

/**
 * A model name, saved on blur or Enter (Esc puts the stored one back). Empty = the provider's
 * default, which the placeholder and the hint name (from `GET /api/ai/status`).
 */
export function AiModelField({
  id,
  label,
  value,
  field,
  defaultModel,
}: {
  id: string;
  label: string;
  value: string | null;
  field: 'chatModel' | 'embeddingModel';
  /** The model used when the field is empty; null until the status has been read. */
  defaultModel: string | null;
}) {
  const { t } = useTranslation();
  const { state, save, clear } = useSettingSave();
  const stored = value ?? '';
  const [draft, setDraft] = useState(stored);
  useLayoutEffect(() => setDraft(stored), [stored]);
  const commit = () => {
    if (draft.trim() === stored) return;
    void save({ ai: { [field]: draft.trim() === '' ? null : draft.trim() } });
  };
  const hintId = `${id}-hint`;
  return (
    <SettingsField
      label={label}
      htmlFor={id}
      status={<SaveStatus state={state} />}
      hint={
        defaultModel ? (
          <span id={hintId}>{t('settings.ai.modelDefault', { model: defaultModel })}</span>
        ) : undefined
      }
    >
      <input
        id={id}
        className="text-input settings-input--model"
        value={draft}
        placeholder={defaultModel ?? undefined}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={defaultModel ? hintId : undefined}
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
