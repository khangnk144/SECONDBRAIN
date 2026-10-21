import { useTranslation } from 'react-i18next';
import type { AiStatus } from '../../lib/api/ai-types';
import type { AiEditorAction } from './ai-action-kinds';
import { aiErrorView, meaningProviderValues, providerValues } from './ai-error-message';
import { blockerMessage, blockerNeedsSettings, type AiBlocker } from './ai-readiness';
import { openAiSettings } from './open-ai-settings';

interface Actions {
  /** Closes the panel, caret back in the editor. */
  onClose: () => void;
  /** Closes the panel without touching focus (the app goes to another screen). */
  onLeave: () => void;
}

const SENT_KEYS: Partial<Record<AiEditorAction, string>> = {
  'suggest-links': 'ai-actions.panel.sentLinks',
  'suggest-tags': 'ai-actions.panel.sentTags',
};

/** "Đang hỏi AI…", what was sent where (honestly, per action), and "Hủy" (aborts the request). */
export function AiPanelLoading({
  action,
  status,
  onClose,
}: Pick<Actions, 'onClose'> & { action: AiEditorAction; status: AiStatus | null }) {
  const { t } = useTranslation();
  const sentKey = SENT_KEYS[action] ?? 'ai-actions.panel.sentTo';
  // Only link suggestions look for related notes, which in hybrid mode embeds the selection.
  const meaning = action === 'suggest-links' ? meaningProviderValues(status, t) : null;
  return (
    <>
      <p role="status" className="ai-panel__status">
        {t('ai-actions.panel.loading')}
      </p>
      <p className="ai-panel__hint">
        {t(sentKey, providerValues(status, t))}
        {meaning ? ` ${t('ai-actions.panel.sentHybrid', meaning)}` : null}
      </p>
      <div className="ai-panel__actions">
        <button type="button" className="button button--secondary" data-autofocus onClick={onClose}>
          {t('ai-actions.panel.cancel')}
        </button>
      </div>
    </>
  );
}

function SettingsButton({ onLeave }: Pick<Actions, 'onLeave'>) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className="button button--secondary"
      onClick={() => {
        onLeave();
        openAiSettings();
      }}
    >
      {t('ai-actions.panel.openSettings')}
    </button>
  );
}

/** Why nothing was sent, and the way out (Settings) when there is one. */
export function AiPanelBlocked({
  blocker,
  status,
  onClose,
  onLeave,
}: Actions & { blocker: AiBlocker; status: AiStatus | null }) {
  const { t, i18n } = useTranslation();
  const message = blockerMessage(blocker, status, i18n.language);
  return (
    <>
      <p role="alert" className="ai-panel__message">
        {t(message.key, message.values)}
      </p>
      <div className="ai-panel__actions">
        {blockerNeedsSettings(blocker) ? <SettingsButton onLeave={onLeave} /> : null}
        <button type="button" className="button button--secondary" data-autofocus onClick={onClose}>
          {t('ai-actions.panel.close')}
        </button>
      </div>
    </>
  );
}

/** What went wrong and what to do: "Thử lại", Settings, or close. */
export function AiPanelError({
  error,
  status,
  onRetry,
  onClose,
  onLeave,
}: Actions & { error: unknown; status: AiStatus | null; onRetry: () => void }) {
  const { t, i18n } = useTranslation();
  const view = aiErrorView(error, status, t, i18n.language);
  return (
    <>
      <p role="alert" className="ai-panel__message">
        {t(view.key, view.values)}
      </p>
      <div className="ai-panel__actions">
        {view.retry ? (
          <button
            type="button"
            className="button button--secondary"
            data-autofocus
            onClick={onRetry}
          >
            {t('ai-actions.panel.retry')}
          </button>
        ) : null}
        {view.settings ? <SettingsButton onLeave={onLeave} /> : null}
        <button type="button" className="button button--secondary" onClick={onClose}>
          {t('ai-actions.panel.close')}
        </button>
      </div>
    </>
  );
}
