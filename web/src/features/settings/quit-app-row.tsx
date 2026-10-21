import { useTranslation } from 'react-i18next';
import { ActionMessage } from './action-message';
import { confirmQuit, stopSecondBrain } from './quit-app';
import { settingsSaveError } from './settings-errors';
import { useActionStatus } from './use-action-status';

export function QuitAppRow() {
  const { t } = useTranslation();
  const { state, run } = useActionStatus();
  const busy = state.kind === 'busy';
  // Ask first: the button stays enabled while the dialog is open, so a cancel returns focus to it.
  const onQuit = async () => {
    if (busy || !(await confirmQuit())) return;
    await run(async () => {
      await stopSecondBrain();
      return t('settings.app.quitDone');
    }, settingsSaveError);
  };
  return (
    <div className="settings-field">
      <div className="settings-field__control">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={busy || undefined}
          onClick={() => void onQuit()}
        >
          {t('settings.app.quit')}
        </button>
      </div>
      <p className="settings-field__hint">{t('settings.app.quitHint')}</p>
      <ActionMessage state={state} />
    </div>
  );
}
