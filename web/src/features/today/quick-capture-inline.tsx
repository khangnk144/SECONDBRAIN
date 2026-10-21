import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { captureToInbox } from '../../lib/capture-flow';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';

/** Enter while an input method is still composing a character (macOS Vietnamese, IMEs) is not "save". */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * "Ghi nhanh" on Today (SPEC F12): Enter saves the text to Inbox, Shift+Enter starts a new line.
 * The box empties after saving and keeps focus; while saving it is read-only (a disabled field
 * would drop focus); when saving fails the text stays so nothing typed is lost.
 */
export function QuickCaptureInline() {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);

  async function save() {
    if (busy.current || text.trim() === '') return;
    busy.current = true;
    setSaving(true);
    const path = await captureToInbox(text);
    busy.current = false;
    setSaving(false);
    if (path !== null) setText('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    void save();
  }

  return (
    <section className="today__section" aria-labelledby={headingId}>
      <h2 id={headingId} className="today__section-title">
        {t('today.capture.title')}
      </h2>
      <textarea
        className="quick-capture-inline"
        value={text}
        rows={2}
        placeholder={t('today.capture.placeholder')}
        aria-labelledby={headingId}
        aria-describedby={hintId}
        aria-busy={saving}
        readOnly={saving}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p id={hintId} className="today__hint">
        <Trans
          i18nKey="today.capture.hint"
          values={{ keys: shortcutKeys('quick-capture') }}
          components={{ kbd: <kbd /> }}
        />
      </p>
      <span role="status" className="visually-hidden">
        {saving ? t('today.capture.saving') : ''}
      </span>
    </section>
  );
}
