import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { VaultPath } from '../../lib/api/vault-types';
import { AnswerSources } from './answer-sources';
import { AnswerView } from './answer-view';
import { failureMessage, failureNeedsSettings, isReadinessFailure } from './chat-errors';
import { retryAnswer } from './chat-send';
import { requestChatFocus } from './chat-store';
import { isAppWrittenTurn, type AssistantTurn, type ChatDone } from './chat-types';
import { openAiSettings } from './open-ai-settings';
import { SaveAnswerDialog } from './save-answer-dialog';

/** Notices the answer shows under it; `empty`/`no-items` need none (the answer itself says so). */
const SHOWN_NOTICES = ['citation-rejected', 'uncited', 'out-of-scope-hidden'];

function knownPaths(turn: AssistantTurn, done: ChatDone): VaultPath[] {
  return [
    ...done.citations.map((citation) => citation.path),
    ...(turn.meta?.sources ?? []).map((source) => source.path),
  ];
}

function FinishedAnswer({
  turn,
  done,
  notePath,
}: {
  turn: AssistantTurn;
  done: ChatDone;
  notePath: VaultPath | null;
}) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const known = useMemo(() => knownPaths(turn, done), [turn, done]);
  const notices = done.notices.filter((notice) => SHOWN_NOTICES.includes(notice));
  const structured = turn.meta?.retrieval === 'structured';
  // "Nothing found" is the app's own sentence: no answer worth keeping as a note.
  const appWritten = isAppWrittenTurn(turn);
  return (
    <>
      <AnswerView
        markdown={done.answer}
        known={known}
        fromPath={notePath ?? ''}
        citations={turn.meta?.kind === 'text'}
      />
      {notices.map((notice) => (
        <p key={notice} className="ai-chat__notice">
          {t(`ai-chat.notices.${notice}`)}
        </p>
      ))}
      {structured ? (
        <p className="ai-chat__note">{t('ai-chat.turn.fromToday')}</p>
      ) : (
        <AnswerSources sources={turn.meta?.sources ?? []} />
      )}
      {appWritten ? null : (
        <div className="ai-chat__buttons">
          <button type="button" className="ai-chat__quiet-button" onClick={() => setSaving(true)}>
            {t('ai-chat.turn.save')}
          </button>
        </div>
      )}
      {saving ? (
        <SaveAnswerDialog
          question={turn.question}
          answer={done.answer}
          notePath={notePath}
          onClose={() => setSaving(false)}
        />
      ) : null}
    </>
  );
}

/**
 * One answer of the assistant, labelled as the AI's (design.md §7: AI text is marked). What the app
 * wrote itself (an error, "nothing found") is not: it is named for screen readers only.
 */
export function AssistantTurnView({
  turn,
  threadId,
  notePath,
}: {
  turn: AssistantTurn;
  threadId: string;
  notePath: VaultPath | null;
}) {
  const { t, i18n } = useTranslation();
  const status = useAiStatusStore((state) => state.status);
  const streaming = turn.status === 'waiting' || turn.status === 'streaming';
  return (
    <li className="ai-chat__turn ai-chat__turn--ai" aria-busy={streaming || undefined}>
      {isAppWrittenTurn(turn) ? (
        <span className="visually-hidden">{t('ai-chat.appNote')}</span>
      ) : (
        <p className="ai-chat__who">{t('ai-chat.assistant')}</p>
      )}
      {turn.status === 'waiting' ? (
        <p className="ai-chat__note">{t('ai-chat.turn.waiting')}</p>
      ) : null}
      {turn.status === 'done' && turn.done ? (
        <FinishedAnswer turn={turn} done={turn.done} notePath={notePath} />
      ) : turn.streamed !== '' ? (
        // Raw text while it arrives; the validated answer replaces it at the end.
        <p className="ai-chat__streamed">{turn.streamed}</p>
      ) : null}
      {turn.status === 'stopped' ? (
        <p className="ai-chat__note">{t('ai-chat.turn.stopped')}</p>
      ) : null}
      {turn.status === 'error' && turn.failure ? (
        <>
          <p className="ai-chat__error" role="alert">
            {failureMessage(turn.failure, t, status, i18n.language)}
          </p>
          <div className="ai-chat__buttons">
            {/* AI off, no key or no budget: asking again cannot help, Settings can. */}
            {isReadinessFailure(turn.failure) ? null : (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => {
                  retryAnswer(threadId, turn.id, { notePath });
                  requestChatFocus(threadId);
                }}
              >
                {t('ai-chat.turn.retry')}
              </button>
            )}
            {failureNeedsSettings(turn.failure) ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => openAiSettings('ai')}
              >
                {t('ai-chat.notReady.openSettings')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </li>
  );
}
