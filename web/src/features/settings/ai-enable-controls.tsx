import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiStatus } from '../../lib/api/ai-types';
import type { SettingsResponse } from '../../lib/api/settings-types';
import { ChatConsentDialog } from './ai-consent-dialogs';
import { AiStatusLine } from './ai-status-line';
import { SaveStatus } from './save-status';
import { useSettingSave } from './use-setting-save';

/**
 * The status sentence and "Bật AI trong app". Turning it on never saves by itself: it opens the
 * consent dialog, and only "Đồng ý và bật" sends `{ enabled: true, consent: true }`. Turning it
 * off saves at once (nothing is sent while off; the consent stays recorded).
 */
export function AiEnableControls({
  ai,
  status,
}: {
  ai: SettingsResponse['ai'];
  status: AiStatus | null;
}) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const { state, save, clear } = useSettingSave();
  const agree = async () => {
    const saved = await save({ ai: { enabled: true, consent: true } });
    if (saved) setAsking(false);
  };
  return (
    <>
      <AiStatusLine ai={ai} status={status} onReviewConsent={() => setAsking(true)} />
      <div className="settings-field">
        <div className="settings-field__control">
          <label className="settings-switch">
            <input
              type="checkbox"
              role="switch"
              checked={ai.enabled}
              aria-describedby="settings-ai-enable-hint"
              onChange={(event) => {
                // Not disabled while saving: a disabled switch would drop the keyboard focus.
                if (state.kind === 'saving') return;
                if (event.target.checked) {
                  clear();
                  setAsking(true);
                } else {
                  void save({ ai: { enabled: false } });
                }
              }}
            />
            <span>{t('settings.ai.enable')}</span>
          </label>
          {asking ? null : <SaveStatus state={state} />}
        </div>
        <p id="settings-ai-enable-hint" className="settings-field__hint">
          {t('settings.ai.enableHint')}
        </p>
      </div>
      {asking ? (
        <ChatConsentDialog
          ai={ai}
          state={state}
          onAgree={() => void agree()}
          onLater={() => {
            clear();
            setAsking(false);
          }}
        />
      ) : null}
    </>
  );
}
