import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { AiSection } from './ai-section';
import { AppSection } from './app-section';
import { AppearanceSection } from './appearance-section';
import { McpSection } from './mcp-section';
import { RemindersSettingsSection } from './reminders-settings-section';
import { useSettingsStore } from './settings-store';
import { VaultSection } from './vault-section';
import './settings-screen.css';
import './settings-ai.css';

const TITLE_ID = 'settings-title';

/**
 * "Cài đặt" (`#/settings`, `Alt+,`; SPEC F18, design.md principle 4: few settings): one calm
 * column; every control saves on its own change and says "Đã lưu".
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const settings = useSettingsStore((state) => state.settings);
  const status = useSettingsStore((state) => state.status);

  useEffect(() => {
    void useSettingsStore.getState().load();
    // What AI may do right now (the store also follows `ai:status` events).
    void useAiStatusStore.getState().load();
  }, []);

  return (
    <article className="settings-screen" aria-labelledby={TITLE_ID}>
      <h1 id={TITLE_ID} className="text-display">
        {t('settings.title')}
      </h1>
      {/* Appearance comes from this window's prefs, so it works before the server answered. */}
      <AppearanceSection />
      {settings ? (
        <>
          <RemindersSettingsSection time={settings.reminders.time} />
          <VaultSection vault={settings.vault} />
          <AppSection settings={settings} />
          <AiSection ai={settings.ai} />
          <McpSection allowNoteEdits={settings.mcp.allowNoteEdits} />
        </>
      ) : status === 'error' ? (
        <div className="settings-screen__note">
          <p role="alert">{t('settings.loadError')}</p>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void useSettingsStore.getState().load()}
          >
            {t('settings.retry')}
          </button>
        </div>
      ) : (
        <p className="settings-screen__note">{t('settings.loading')}</p>
      )}
    </article>
  );
}
