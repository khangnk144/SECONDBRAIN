import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { askQuestion, MAX_QUESTION_LENGTH, newConversation, stopAnswer } from './chat-send';
import { getThread, requestChatFocus, setDraft, useChatStore, useChatThread } from './chat-store';

export interface ChatComposerProps {
  threadId: string;
  notePath: VaultPath | null;
  busy: boolean;
  hasTurns: boolean;
  rows: number;
}

/**
 * The question box: Enter sends, Shift+Enter adds a line, Esc leaves the box. One button asks or,
 * while an answer streams, stops it (the same element, so focus stays on it).
 */
export function ChatComposer({ threadId, notePath, busy, hasTurns, rows }: ChatComposerProps) {
  const { t } = useTranslation();
  const { draft } = useChatThread(threadId);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputId = useId();
  const hintId = useId();
  const problemId = useId();
  const [problem, setProblem] = useState<string | null>(null);
  const focus = useChatStore((state) => state.focus);

  // Palette command, starters, "Cuộc trò chuyện mới": focus the box, caret at the end.
  useEffect(() => {
    const input = inputRef.current;
    if (focus?.threadId !== threadId || !input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    useChatStore.setState({ focus: null });
  }, [focus, threadId]);

  const empty = draft.trim() === '';
  const submit = () => {
    if (busy || empty) return;
    const question = draft.trim();
    if ([...question].length > MAX_QUESTION_LENGTH) {
      setProblem(t('ai-chat.input.tooLong', { max: MAX_QUESTION_LENGTH }));
      return;
    }
    setProblem(null);
    setDraft(threadId, '');
    void askQuestion(threadId, question, { notePath }).then((asked) => {
      // Not sent after all (AI turned out not to be ready): give the text back.
      if (!asked && getThread(threadId).draft === '') setDraft(threadId, question);
    });
  };

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // An input method may use Enter to confirm a word: that Enter never sends.
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      submit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
    }
  }

  return (
    <form
      className="ai-chat__composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor={inputId} className="visually-hidden">
        {t('ai-chat.input.label')}
      </label>
      <textarea
        ref={inputRef}
        id={inputId}
        className="ai-chat__input"
        rows={rows}
        value={draft}
        placeholder={t('ai-chat.input.placeholder')}
        aria-describedby={problem ? `${problemId} ${hintId}` : hintId}
        aria-invalid={problem ? true : undefined}
        onChange={(event) => {
          setDraft(threadId, event.target.value);
          if (problem) setProblem(null);
        }}
        onKeyDown={onKeyDown}
      />
      {problem ? (
        <p id={problemId} className="ai-chat__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <div className="ai-chat__buttons">
        {busy ? (
          <button
            key="ask"
            type="button"
            className="button button--secondary"
            onClick={() => stopAnswer(threadId)}
          >
            {t('ai-chat.input.stop')}
          </button>
        ) : (
          <button
            key="ask"
            type="submit"
            className="button button--primary"
            aria-disabled={empty ? true : undefined}
          >
            {t('ai-chat.input.ask')}
          </button>
        )}
        {hasTurns ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              newConversation(threadId);
              requestChatFocus(threadId);
            }}
          >
            {t('ai-chat.input.newConversation')}
          </button>
        ) : null}
      </div>
      <p id={hintId} className="ai-chat__hint">
        {t('ai-chat.input.hint')}
      </p>
    </form>
  );
}
