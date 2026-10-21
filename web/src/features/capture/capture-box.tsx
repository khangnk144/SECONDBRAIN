import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { captureToInbox, MAX_CAPTURE_LENGTH } from '../../lib/capture-flow';
import { useCaptureUi } from '../../lib/capture-ui-store';
import { suspendShortcuts } from '../../lib/shortcuts/shortcut-registry';
import { useFocusTrap } from '../dialogs/use-focus-trap';

/** Keys the capture box handles itself (the shortcut sheet lists them too). */
export const CAPTURE_KEYS = [
  { keys: 'Enter', labelKey: 'capture.keySave' },
  { keys: 'Shift+Enter', labelKey: 'capture.keyNewLine' },
  { keys: 'Esc', labelKey: 'capture.keyCancel' },
] as const;

type Problem = 'failed' | 'tooLong';

/**
 * The open quick-capture box (design.md screen 4): one multi-line field on the blush surface.
 * Enter saves to Inbox, Shift+Enter adds a line, Esc cancels; focus goes back to where it was
 * (the store remembers it; the editor keeps its caret). App shortcuts are suspended meanwhile.
 * A failed save keeps the text and says what to do.
 */
export function CaptureBox({ onSaved }: { onSaved: (text: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const titleId = useId();
  const hintsId = useId();
  const problemId = useId();

  const cancel = () => useCaptureUi.getState().close();
  useFocusTrap(boxRef, { onEscape: cancel, initialFocus: inputRef });
  useEffect(() => suspendShortcuts(), []);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const empty = text.trim() === '';

  async function save() {
    if (busy || empty) return;
    if ([...text.trim()].length > MAX_CAPTURE_LENGTH) {
      setProblem('tooLong');
      return;
    }
    setBusy(true);
    setProblem(null);
    const path = await captureToInbox(text);
    if (!mounted.current) return;
    setBusy(false);
    if (path === null) {
      setProblem('failed');
      inputRef.current?.focus();
      return;
    }
    onSaved(text);
    useCaptureUi.getState().close();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter inside an input-method composition picks a word; it must not save.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void save();
  }

  return (
    <div
      className="capture-layer"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // A click beside an empty box closes it; typed text is never thrown away by a stray click.
        if (empty) cancel();
        else event.preventDefault();
      }}
    >
      <div
        ref={boxRef}
        className="capture-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy}
        tabIndex={-1}
      >
        <h2 id={titleId} className="visually-hidden">
          {t('capture.title')}
        </h2>
        <textarea
          ref={inputRef}
          className="capture-box__input"
          rows={3}
          value={text}
          readOnly={busy}
          placeholder={t('capture.placeholder')}
          aria-label={t('capture.inputLabel')}
          aria-invalid={problem !== null}
          aria-describedby={problem ? `${problemId} ${hintsId}` : hintsId}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {problem ? (
          <p id={problemId} className="capture-box__problem" role="alert">
            {problem === 'tooLong'
              ? t('capture.tooLong', { max: MAX_CAPTURE_LENGTH })
              : t('capture.failed')}
          </p>
        ) : null}
        <div className="capture-box__footer">
          <p id={hintsId} className="capture-box__hints">
            {CAPTURE_KEYS.map((hint) => (
              <span key={hint.keys} className="capture-box__hint">
                <kbd>{hint.keys}</kbd> {t(hint.labelKey)}
              </span>
            ))}
          </p>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || empty}
            onClick={() => void save()}
          >
            {t('capture.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
