import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { deleteSampleData, restoreTemplates, revealLogs } from '../../lib/api/settings-api';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { getSampleDataStatus } from '../today/sample-data-api';
import { ActionMessage } from './action-message';
import { settingsSaveError } from './settings-errors';
import { useActionStatus } from './use-action-status';

function ActionRow({
  label,
  hint,
  onClick,
  state,
  busyText,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
  state: ReturnType<typeof useActionStatus>['state'];
  busyText?: string;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={state.kind === 'busy' || undefined}
          onClick={onClick}
        >
          {label}
        </button>
      </div>
      {hint ? <p className="settings-field__hint">{hint}</p> : null}
      <ActionMessage state={state} busyText={busyText} />
    </div>
  );
}

/** "Khôi phục mẫu gốc": missing bundled templates come back; existing ones are never touched. */
export function TemplatesRestoreRow() {
  const { t } = useTranslation();
  const { state, run } = useActionStatus();
  return (
    <ActionRow
      label={t('settings.vault.templates')}
      hint={t('settings.vault.templatesHint')}
      state={state}
      onClick={() =>
        void run(async () => {
          const { restored } = await restoreTemplates();
          return restored.length === 0
            ? t('settings.vault.templatesNone')
            : t('settings.vault.templatesDone', { count: restored.length });
        }, settingsSaveError)
      }
    />
  );
}

/** "Xóa dữ liệu mẫu": only while the sample set is recorded; edited sample files stay. */
export function SampleDataRow() {
  const { t } = useTranslation();
  const [present, setPresent] = useState(false);
  const { state, run } = useActionStatus();
  useEffect(() => {
    let live = true;
    getSampleDataStatus()
      .then((status) => live && setPresent(status.present))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  if (!present) {
    // After the deletion only the outcome stays (the sample set is gone).
    return state.kind === 'done' ? <ActionMessage state={state} /> : null;
  }
  // Ask first, then work: the button is never busy while the dialog is open, so a cancel
  // returns focus to it.
  const onDelete = async () => {
    if (state.kind === 'busy') return;
    const confirmed = await confirmDialog({
      title: t('settings.vault.sampleConfirmTitle'),
      body: t('settings.vault.sampleConfirmBody'),
      confirmLabel: t('settings.vault.sampleConfirm'),
      danger: true,
    });
    if (!confirmed) return;
    await run(async () => {
      const result = await deleteSampleData();
      setPresent(false);
      const removed = t('settings.vault.sampleDone', { count: result.removed.length });
      if (result.kept.length === 0) return removed;
      const names = result.kept.map(noteTitleFromPath).join(', ');
      return `${removed} ${t('settings.vault.sampleKept', { count: result.kept.length, names })}`;
    }, settingsSaveError);
  };
  return (
    <ActionRow
      label={t('settings.vault.sample')}
      hint={t('settings.vault.sampleHint')}
      state={state}
      onClick={() => void onDelete()}
    />
  );
}

/** "Mở thư mục log": opens the log folder in Explorer. */
export function LogsRevealRow() {
  const { t } = useTranslation();
  const { state, run } = useActionStatus();
  return (
    <ActionRow
      label={t('settings.vault.logs')}
      state={state}
      onClick={() =>
        void run(async () => {
          await revealLogs();
          return t('settings.vault.logsDone');
        }, settingsSaveError)
      }
    />
  );
}
