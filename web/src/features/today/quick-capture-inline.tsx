import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { shortcutKeys } from '../../lib/shortcuts/use-app-shortcuts';
import { useInlineCapture } from './use-inline-capture';

/**
 * "Ghi nhanh" on Today (SPEC F12): Enter saves the text to Inbox, Shift+Enter starts a new line.
 * The box empties after saving and keeps focus; while saving it is read-only (a disabled field
 * would drop focus); when saving fails the text stays so nothing typed is lost.
 */
export function QuickCaptureInline() {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const { text, setText, saving, onKeyDown } = useInlineCapture();

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
