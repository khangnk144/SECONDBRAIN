import { Plus } from '@phosphor-icons/react';
import { useId } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { shortcutKeys } from '../../../lib/shortcuts/use-app-shortcuts';
import { useInlineCapture } from '../use-inline-capture';

/**
 * "Ghi nhanh" (4 columns, SPEC F12): a 50 px field and the square "+" button (named "Lưu vào
 * Inbox"); Enter or the button saves to Inbox through the same flow as calm Today; the hint
 * names the shortcut that opens quick capture anywhere.
 */
export function BentoCaptureTile() {
  const { t } = useTranslation();
  const headingId = useId();
  const hintId = useId();
  const { text, setText, saving, save, onKeyDown } = useInlineCapture();

  return (
    <section className="tile today-tile today-tile--capture" aria-labelledby={headingId}>
      <h2 id={headingId} className="today-tile__title">
        {t('today.bento.capture.title')}
      </h2>
      <div className="today-capture">
        <input
          type="text"
          className="today-capture__input"
          value={text}
          placeholder={t('today.bento.capture.placeholder')}
          aria-labelledby={headingId}
          aria-describedby={hintId}
          aria-busy={saving}
          readOnly={saving}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="today-capture__save"
          aria-label={t('today.bento.capture.save')}
          aria-disabled={saving || text.trim() === ''}
          onClick={() => void save()}
        >
          <Plus size={16} weight="bold" aria-hidden="true" focusable="false" />
        </button>
      </div>
      <p id={hintId} className="today-tile__hint">
        <Trans
          i18nKey="today.bento.capture.hint"
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
