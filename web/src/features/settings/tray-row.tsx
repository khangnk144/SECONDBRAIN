import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SystemInfo } from '../../lib/api/system-types';
import { SaveStatus } from './save-status';
import { useSettingsStore } from './settings-store';
import { useSystemInfoStore } from './system-info-store';
import { useSettingSave } from './use-setting-save';

/** How often the row asks again while the helper is starting (it reports the hotkey). */
export const TRAY_POLL_MS = 2_000;
const MAX_POLLS = 15;

type TrayLine = 'starting' | 'running' | 'hotkeyTaken' | 'off' | 'failed';

/** The status sentence for the switch (`wanted` = the stored setting). */
export function trayLine(wanted: boolean, tray: SystemInfo['tray'] | undefined): TrayLine {
  if (!wanted) return 'off';
  if (!tray || tray.state === 'off') return 'starting';
  if (tray.state === 'failed') return 'failed';
  if (tray.hotkeyRegistered === false) return 'hotkeyTaken';
  return tray.hotkeyRegistered ? 'running' : 'starting';
}

/**
 * "Biểu tượng khay và phím tắt toàn hệ thống" (SPEC F29.2, F29.3), Windows only: a real checkbox
 * announced as a switch, and a line saying what the tray helper does right now (including
 * "Ctrl+Alt+Q is used by another app").
 */
export function TrayRow() {
  const { t } = useTranslation();
  const system = useSettingsStore((state) => state.settings?.system);
  const tray = useSystemInfoStore((state) => state.info?.tray);
  const { state, save } = useSettingSave();
  const wanted = system?.tray ?? true;
  const line = trayLine(wanted, tray);

  useEffect(() => {
    void useSystemInfoStore.getState().load();
  }, []);
  // While the helper starts (after a switch or a language change), ask until it reported.
  useEffect(() => {
    if (line !== 'starting' && !(line === 'off' && tray?.state === 'running')) return;
    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) clearInterval(timer);
      else void useSystemInfoStore.getState().load();
    }, TRAY_POLL_MS);
    return () => clearInterval(timer);
  }, [line, tray?.state]);

  if (!system || system.platform !== 'windows') return null;
  const notice = line === 'hotkeyTaken' || line === 'failed';
  return (
    <div className="settings-field">
      <label className="settings-switch">
        <input
          type="checkbox"
          role="switch"
          checked={wanted}
          disabled={state.kind === 'saving'}
          aria-describedby="settings-tray-status settings-tray-hint"
          onChange={async (event) => {
            await save({ system: { tray: event.target.checked } });
            void useSystemInfoStore.getState().load();
          }}
        />
        <span>{t('app-install.tray.label')}</span>
        <SaveStatus state={state} />
      </label>
      <p
        id="settings-tray-status"
        className={notice ? 'settings-field__notice' : 'settings-field__hint'}
        role="status"
      >
        {t(`app-install.tray.${line}`)}
      </p>
      <p id="settings-tray-hint" className="settings-field__hint">
        {t('app-install.tray.hint')}
      </p>
    </div>
  );
}
