import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isApiError } from '../../lib/api-client';
import { recreateShortcuts } from '../../lib/api/system-api';
import { ActionMessage } from './action-message';
import { settingsSaveError } from './settings-errors';
import { useSystemInfoStore } from './system-info-store';
import { useActionStatus } from './use-action-status';

/**
 * How the app runs (SPEC F29.4): the .exe (with its path and "Tạo lại lối tắt trên màn hình")
 * or from the source code (on Windows with how to make the .exe and the SmartScreen hint, F29.5).
 */
export function InstallInfoRow() {
  const { t } = useTranslation();
  const info = useSystemInfoStore((state) => state.info);
  const { state, run } = useActionStatus();
  const busy = state.kind === 'busy';

  useEffect(() => {
    void useSystemInfoStore.getState().load();
  }, []);

  if (!info) return null;
  const exe = info.runtime === 'exe';
  const onRecreate = () =>
    run(
      async () => {
        await recreateShortcuts();
        return t('app-install.install.shortcutsDone');
      },
      (error) =>
        isApiError(error) && error.details.reason === 'shortcut-failed'
          ? t('app-install.install.shortcutsFailed')
          : settingsSaveError(error),
    );

  return (
    <div className="settings-field">
      <p className="settings-field__label">{t('app-install.install.label')}</p>
      <p className="settings-field__value">
        {exe ? t('app-install.install.exe') : t('app-install.install.source')}
      </p>
      {exe && info.exePath ? (
        <p className="settings-field__hint settings-path">
          {t('app-install.install.exePath', { path: info.exePath })}
        </p>
      ) : null}
      {!exe && info.platform === 'windows' ? (
        <>
          <p className="settings-field__hint">{t('app-install.install.sourceHint')}</p>
          <p className="settings-field__hint">{t('app-install.install.smartScreen')}</p>
        </>
      ) : null}
      {info.shortcuts.supported ? (
        <>
          <div className="settings-field__control">
            <button
              type="button"
              className="button button--secondary"
              aria-disabled={busy || undefined}
              aria-describedby="settings-shortcuts-hint"
              onClick={() => void (busy ? undefined : onRecreate())}
            >
              {t('app-install.install.shortcuts')}
            </button>
          </div>
          <p id="settings-shortcuts-hint" className="settings-field__hint">
            {t('app-install.install.shortcutsHint')}
          </p>
          <ActionMessage state={state} />
        </>
      ) : null}
    </div>
  );
}
