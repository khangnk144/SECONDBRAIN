import { useLayoutEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { InstallAppButton } from '../../pwa/install-app-button';
import { useInstallPrompt } from '../../pwa/install-prompt-store';
import { QuitAppRow } from './quit-app-row';
import { SaveStatus } from './save-status';
import { SettingsField, SettingsSection } from './settings-section';
import { useSettingSave } from './use-setting-save';

export const MIN_PORT = 1024;
export const MAX_PORT = 65_535;

/** A whole number in the allowed range, or null. */
export function parsePort(text: string): number | null {
  if (!/^\d{1,5}$/.test(text.trim())) return null;
  const port = Number(text.trim());
  return port >= MIN_PORT && port <= MAX_PORT ? port : null;
}

/** "Chạy khi đăng nhập Windows" (SPEC F18.6): a real checkbox announced as a switch. */
function RunAtLoginSwitch({ system }: { system: SettingsResponse['system'] }) {
  const { t } = useTranslation();
  const { state, save } = useSettingSave();
  const supported = system.runAtLoginSupported;
  return (
    <div className="settings-field">
      <label className="settings-switch">
        <input
          type="checkbox"
          role="switch"
          checked={system.runAtLogin}
          disabled={!supported || state.kind === 'saving'}
          aria-describedby="settings-run-at-login-hint"
          onChange={(event) => void save({ system: { runAtLogin: event.target.checked } })}
        />
        <span>{t('settings.app.runAtLogin')}</span>
        <SaveStatus state={state} />
      </label>
      <p id="settings-run-at-login-hint" className="settings-field__hint">
        {supported ? t('settings.app.runAtLoginHint') : t('settings.app.runAtLoginUnsupported')}
      </p>
    </div>
  );
}

function PortField({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const { state, save, fail, clear } = useSettingSave();
  const stored = String(settings.configuredPort);
  const [draft, setDraft] = useState(stored);
  useLayoutEffect(() => setDraft(stored), [stored]);
  const commit = () => {
    if (draft.trim() === stored) return;
    const port = parsePort(draft);
    if (port === null) {
      fail(t('settings.app.portInvalid', { min: MIN_PORT, max: MAX_PORT }));
      return;
    }
    void save({ port });
  };
  return (
    <SettingsField
      label={t('settings.app.port')}
      htmlFor="settings-port"
      status={<SaveStatus state={state} id="settings-port-status" />}
      hint={
        <>
          <p>{t('settings.app.portRunning', { port: settings.port })}</p>
          {settings.restartRequired ? (
            <>
              <p className="settings-field__notice">{t('settings.app.restartRequired')}</p>
              <p className="settings-field__notice">{t('settings.app.reinstallAfterPort')}</p>
            </>
          ) : null}
        </>
      }
    >
      <input
        id="settings-port"
        className="text-input settings-input--port"
        inputMode="numeric"
        value={draft}
        aria-describedby="settings-port-status"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          // Esc puts the saved port back, and with it goes the error about the typed one.
          if (event.key === 'Escape') {
            setDraft(stored);
            clear();
          }
        }}
      />
    </SettingsField>
  );
}

/** "Ứng dụng": start with Windows, the port, installing the app, quitting. */
export function AppSection({ settings }: { settings: SettingsResponse }) {
  const { t } = useTranslation();
  const install = useInstallPrompt();
  // The button (or the hint for browsers without an install prompt) shows only when it can act.
  const showInstall = !install.installed && (install.canInstall || !install.promptSupported);
  return (
    <SettingsSection id="app" title={t('settings.app.title')}>
      <RunAtLoginSwitch system={settings.system} />
      <PortField settings={settings} />
      {showInstall ? (
        <div className="settings-field">
          <div className="settings-field__control">
            <InstallAppButton />
          </div>
        </div>
      ) : null}
      <QuitAppRow />
    </SettingsSection>
  );
}
