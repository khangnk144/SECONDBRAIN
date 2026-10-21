import { DownloadSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useInstallPrompt } from './install-prompt-store';
import './install-app-button.css';

/**
 * "Cài đặt app" for Settings: shown while the browser offers its install prompt, hidden once
 * the app is installed (or running as the installed app). Browsers without an install prompt
 * (Firefox, Safari) get a hint instead.
 */
export function InstallAppButton() {
  const { t } = useTranslation();
  const { canInstall, installed, promptSupported, promptInstall } = useInstallPrompt();
  if (installed) return null;
  if (canInstall) {
    return (
      <button
        type="button"
        className="button button--secondary install-app-button"
        data-testid="install-app-button"
        onClick={() => {
          // A refused or interrupted prompt changes nothing; the browser keeps its own menu entry.
          promptInstall().catch(() => undefined);
        }}
      >
        <DownloadSimple size={18} aria-hidden="true" focusable="false" />
        {t('pwa.install.button')}
      </button>
    );
  }
  if (!promptSupported) return <p className="install-app-hint">{t('pwa.install.hint')}</p>;
  return null;
}
