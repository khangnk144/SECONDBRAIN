import { useTranslation } from 'react-i18next';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { AiChat } from './ai-chat';
import { chatSentCopy } from './chat-sent-copy';
import { requestChatFocus, setDraft, useChatThread } from './chat-store';
import { ASK_THREAD } from './chat-types';
import './ask-screen.css';

const TITLE_ID = 'ask-title';

/** Starter questions: each fills the box (caret at the end) without sending. */
const STARTERS = [
  { label: 'ai-chat.screen.starterDue', text: 'ai-chat.screen.starterDue' },
  { label: 'ai-chat.screen.starterToday', text: 'ai-chat.screen.starterToday' },
  { label: 'ai-chat.screen.starterSummary', text: 'ai-chat.screen.starterSummaryText' },
] as const;

/**
 * "Hỏi ghi chú của bạn" (`#/ask`): a calm screen around the chat, with three starter questions
 * while the conversation is empty and the search mode in use (keywords, or keywords and meaning).
 */
export function AskScreen() {
  const { t } = useTranslation();
  const status = useAiStatusStore((state) => state.status);
  const { turns } = useChatThread(ASK_THREAD);
  const ready = status === null || status.ready;
  // Said plainly while AI is on: what leaves the computer, and to whom.
  const sent = status?.ready ? chatSentCopy(status, t) : null;
  const mode =
    status?.available && status.ready
      ? t(status.retrieval === 'hybrid' ? 'ai-chat.screen.modeHybrid' : 'ai-chat.screen.modeBm25')
      : null;

  return (
    <section className="ask-screen" aria-labelledby={TITLE_ID}>
      <h1 id={TITLE_ID} className="text-display">
        {t('ai-chat.screen.title')}
      </h1>
      <p className="ask-screen__intro">
        {t('ai-chat.screen.intro')}
        {sent ? ` ${sent}` : null}
        {mode ? ` ${mode}` : null}
      </p>
      {ready && turns.length === 0 ? (
        <div
          className="ask-screen__starters"
          role="group"
          aria-label={t('ai-chat.screen.startersLabel')}
        >
          {STARTERS.map((starter) => (
            <button
              key={starter.label}
              type="button"
              className="ask-screen__starter"
              onClick={() => {
                setDraft(ASK_THREAD, t(starter.text));
                requestChatFocus(ASK_THREAD);
              }}
            >
              {t(starter.label)}
            </button>
          ))}
        </div>
      ) : null}
      <AiChat threadId={ASK_THREAD} variant="screen" />
    </section>
  );
}
