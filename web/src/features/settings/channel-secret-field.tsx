import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ApiKeyStatus, SettingsPatch } from '../../lib/api/settings-types';
import { useChannelSettingSave, type ChannelArea } from './channel-setting-save';
import { SaveStatus } from './save-status';
import { SettingsField } from './settings-section';

/**
 * A secret of the backup or reminder-channel sections (GitHub token, bot token, SMTP password),
 * like the API-key field: never shown again (only "…abcd" from the server), saved on Enter or
 * "Lưu", the field empties after a save, "Xóa khóa" removes it.
 */
export function ChannelSecretField({
  id,
  area,
  label,
  name,
  status,
  toPatch,
  hint,
}: {
  id: string;
  area: ChannelArea;
  label: string;
  /** What the secret is, for the button names ("Lưu mã bot"). */
  name: string;
  status: ApiKeyStatus;
  toPatch: (value: string | null) => SettingsPatch;
  hint?: string;
}) {
  const { t } = useTranslation();
  const { state, save, fail } = useChannelSettingSave(area);
  const [value, setValue] = useState('');
  const statusId = `${id}-status`;
  const hintId = `${id}-hint`;

  const submit = async () => {
    const secret = value.trim();
    if (secret === '') return fail(t('backup-schedule.secret.empty'));
    if (await save(toPatch(secret))) setValue('');
  };
  const stored = status.set
    ? status.last4
      ? t('backup-schedule.secret.saved', { last4: status.last4 })
      : t('backup-schedule.secret.savedShort')
    : t('backup-schedule.secret.none');

  return (
    <SettingsField
      label={label}
      htmlFor={id}
      status={<SaveStatus state={state} id={statusId} />}
      hint={
        <>
          <span id={hintId}>{stored}</span>
          {hint ? <span>{hint}</span> : null}
        </>
      }
    >
      <input
        id={id}
        type="password"
        className="text-input settings-input--key"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={`${hintId} ${statusId}`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void submit();
        }}
      />
      <button
        type="button"
        className="button button--secondary"
        disabled={value.trim() === '' || state.kind === 'saving'}
        aria-label={t('backup-schedule.secret.saveNamed', { name })}
        onClick={() => void submit()}
      >
        {t('backup-schedule.secret.save')}
      </button>
      {status.set ? (
        <button
          type="button"
          className="button button--secondary"
          disabled={state.kind === 'saving'}
          aria-label={t('backup-schedule.secret.removeNamed', { name })}
          onClick={() => void save(toPatch(null))}
        >
          {t('backup-schedule.secret.remove')}
        </button>
      ) : null}
    </SettingsField>
  );
}
