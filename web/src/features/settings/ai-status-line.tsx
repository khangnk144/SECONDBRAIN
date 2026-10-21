import { useTranslation } from 'react-i18next';
import { aiProviderName } from '../../lib/ai-provider-name';
import type { AiStatus } from '../../lib/api/ai-types';
import type { SettingsResponse } from '../../lib/api/settings-types';

type AiSettings = SettingsResponse['ai'];

export type ChatLineKey =
  'ready' | 'off' | 'reconsent' | 'consent' | 'noKey' | 'budget' | 'unavailable';

/**
 * Which sentence says what AI does now. The switch follows the stored settings at once; the rest
 * comes from the server's status (consent, key, budget), so it never claims more than is true.
 */
export function chatLineKey(ai: AiSettings, status: AiStatus | null): ChatLineKey | null {
  if (!ai.enabled) return 'off';
  if (!status) return null;
  if (!status.available) return 'unavailable';
  switch (status.reason) {
    case null:
      return 'ready';
    case 'disabled':
      return 'off';
    case 'no-consent':
      // A consent given for another provider no longer counts (SPEC F33 consent).
      return ai.consent && ai.consent.provider !== ai.provider ? 'reconsent' : 'consent';
    case 'no-key':
      return 'noKey';
    case 'budget':
      return 'budget';
  }
}

/** "AI đang bật với …" or the reason it is not, with "Xem và đồng ý" when consent is missing. */
export function AiStatusLine({
  ai,
  status,
  onReviewConsent,
}: {
  ai: AiSettings;
  status: AiStatus | null;
  onReviewConsent: () => void;
}) {
  const { t } = useTranslation();
  const key = chatLineKey(ai, status);
  if (key === null) return null;
  const provider = aiProviderName(ai.provider, t);
  const text = t(`settings.ai.status.${key}`, { provider, model: status?.chatModel ?? '' });
  const needsConsent = key === 'consent' || key === 'reconsent';
  return (
    <div className="settings-field">
      <p
        className={
          key === 'ready' || key === 'off'
            ? 'settings-ai-status'
            : 'settings-ai-status settings-field__notice'
        }
        role="status"
      >
        {text}
      </p>
      {needsConsent ? (
        <div className="settings-field__control">
          <button type="button" className="button button--secondary" onClick={onReviewConsent}>
            {t('settings.ai.reviewConsent')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
