import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { VaultPath } from '../../lib/api/vault-types';
import { AiNotReady } from './ai-not-ready';
import { AssistantTurnView } from './assistant-turn-view';
import { ChatComposer } from './chat-composer';
import { isThreadBusy, useChatThread } from './chat-store';
import { isAppWrittenTurn } from './chat-types';
import './ai-chat.css';

export interface AiChatProps {
  threadId: string;
  /** The note the questions are about (note panel), sent as `notePath`. */
  notePath?: VaultPath | null;
  variant: 'panel' | 'screen';
}

/**
 * Chat with your notes (SPEC F33, design.md screen 7): the conversation, then the question box
 * (or, while AI may not be used, why not and where to fix it). Answers are short, marked as the
 * AI's, link back to the notes and can be saved as a note.
 */
export function AiChat({ threadId, notePath = null, variant }: AiChatProps) {
  const { t } = useTranslation();
  const status = useAiStatusStore((state) => state.status);
  const thread = useChatThread(threadId);
  const busy = isThreadBusy(thread);
  const listRef = useRef<HTMLOListElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const last = thread.turns.at(-1);
  const lastKey = last ? `${last.id}:${last.role === 'assistant' ? last.status : ''}` : '';

  // A new turn or a finished answer comes into view; deltas never pull the page while reading.
  useEffect(() => {
    const item = listRef.current?.lastElementChild;
    if (item instanceof HTMLElement) item.scrollIntoView?.({ block: 'nearest' });
    if (last?.role !== 'assistant') return;
    const text =
      last.status === 'done'
        ? // The app's own "nothing found" is read out as it is, not as an answer of the AI.
          isAppWrittenTurn(last)
          ? (last.done?.answer ?? '')
          : t('ai-chat.turn.answered')
        : last.status === 'stopped'
          ? t('ai-chat.turn.stopped')
          : '';
    if (text === '') return;
    // Cleared first, so the same sentence is announced again for the next answer.
    setAnnouncement('');
    const id = window.setTimeout(() => setAnnouncement(text), 50);
    return () => window.clearTimeout(id);
    // `lastKey` names the turn and its state; the turn object itself changes on every delta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastKey]);

  const notReady = status !== null && !status.ready;
  return (
    <div className={`ai-chat ai-chat--${variant}`}>
      {thread.turns.length > 0 ? (
        <ol ref={listRef} className="ai-chat__turns" aria-label={t('ai-chat.conversation')}>
          {thread.turns.map((turn) =>
            turn.role === 'user' ? (
              <li key={turn.id} className="ai-chat__turn ai-chat__turn--you">
                <span className="visually-hidden">{t('ai-chat.you')}</span>
                <p className="ai-chat__question">{turn.text}</p>
              </li>
            ) : (
              <AssistantTurnView
                key={turn.id}
                turn={turn}
                threadId={threadId}
                notePath={notePath}
              />
            ),
          )}
        </ol>
      ) : null}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {notReady && status ? (
        <AiNotReady status={status} threadId={threadId} />
      ) : (
        <ChatComposer
          threadId={threadId}
          notePath={notePath}
          busy={busy}
          hasTurns={thread.turns.length > 0}
          rows={variant === 'screen' ? 3 : 2}
        />
      )}
    </div>
  );
}
