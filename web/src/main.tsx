import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './pwa/start-pwa';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/app';
import { initI18n } from './i18n';
import { applyUiPrefs } from './lib/apply-ui-prefs';
import { readBootConfig } from './lib/boot-config';
import { setApiToken } from './lib/api';
import { useUiPrefsStore } from './lib/ui-prefs-store';

const boot = readBootConfig(document);
applyUiPrefs(boot.ui);
initI18n(boot.ui.language);
useUiPrefsStore.getState().setPrefs(boot.ui);
setApiToken(boot.token);

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
