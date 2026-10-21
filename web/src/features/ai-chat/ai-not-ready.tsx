import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiStatus } from '../../lib/api/ai-types';
import { budgetMessage } from './chat-errors';
import { useChatStore } from './chat-store';
import { openAiSettings } from './open-ai-settings';

/**
 * Shown instead of the input while AI may not be used (SPEC F33: no key → an explanation and the
 * Claude Desktop route; AI off or no consent; the month's limit reached). Nothing can be sent
 * from here. A focus request for the thread lands on the first button.
 */
export function AiNotReady({ status, threadId }: { status: AiStatus; threadId: string }) {
  const { t, i18n } = useTranslation();
  const firstRef = useRef<HTMLButtonElement>(null);
  const focus = useChatStore((state) => state.focus);
  useEffect(() => {
    if (focus?.threadId !== threadId) return;
    firstRef.current?.focus();
    useChatStore.setState({ focus: null });
  }, [focus, threadId]);

  const reason = status.reason ?? 'disabled';
  const settingsButton = (
    <button
      ref={firstRef}
      type="button"
      className="button button--secondary"
      onClick={() => openAiSettings('ai')}
    >
      {t('ai-chat.notReady.openSettings')}
    </button>
  );
  return (
    <div className="ai-chat__not-ready">
      {reason === 'no-key' ? (
        <>
          <p>{t('ai-chat.notReady.noKey')}</p>
          <p>{t('ai-chat.notReady.routeA')}</p>
          <div className="ai-chat__buttons">
            {settingsButton}
            <button
              type="button"
              className="button button--secondary"
              onClick={() => openAiSettings('mcp')}
            >
              {t('ai-chat.notReady.openMcp')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            {reason === 'budget'
              ? budgetMessage(status, t, i18n.language)
              : // The switch is still on after a provider change: only the consent is missing.
                t(
                  reason === 'no-consent'
                    ? 'ai-chat.notReady.reconsent'
                    : 'ai-chat.notReady.disabled',
                )}
          </p>
          <div className="ai-chat__buttons">{settingsButton}</div>
        </>
      )}
    </div>
  );
}
