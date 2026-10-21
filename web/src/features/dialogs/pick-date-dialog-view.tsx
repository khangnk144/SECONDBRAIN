import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  addMonths,
  formatIsoDate,
  parseIsoDate,
  todayDate,
  type CalendarDate,
} from '../../editor/local-dates';
import type { PickDateDialogOptions } from '../../lib/dialogs/dialog-requests';
import { DatePickerGrid, pickerDateText } from './date-picker-grid';
import { ModalFrame } from './modal-frame';
import { formatTypedDate, parseTypedDate } from './typed-date';
import './pick-date-dialog.css';

/**
 * "Dời ngày…" and every other date question: a month grid that works by keyboard alone (focus
 * starts on the current date) plus a typed `dd/mm/yyyy` field; both stay in step (SPEC F11.3).
 */
export function PickDateDialogView({
  options,
  onDone,
}: {
  options: PickDateDialogOptions;
  onDone: (value: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const titleId = useId();
  const monthId = useId();
  const hintId = useId();
  const inputId = useId();
  const errorId = useId();
  const [today] = useState(() => todayDate());
  const [active, setActive] = useState<CalendarDate>(
    () => (options.initial ? parseIsoDate(options.initial) : null) ?? today,
  );
  const [typed, setTyped] = useState(() => formatTypedDate(active));
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const locale = i18n.language === 'en' ? 'en' : 'vi';
  const monthLabel = pickerDateText(
    { ...active, day: 1 },
    locale,
    t('dialogs.pickDate.monthFormat'),
  );

  function move(date: CalendarDate) {
    setActive(date);
    setTyped(formatTypedDate(date));
    setError(null);
  }

  function onTypedChange(value: string) {
    setTyped(value);
    setError(null);
    const iso = parseTypedDate(value);
    const date = iso ? parseIsoDate(iso) : null;
    if (date) setActive(date);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const iso = typed.trim() === '' ? formatIsoDate(active) : parseTypedDate(typed);
    if (iso === null) {
      setError(t('dialogs.pickDate.invalid'));
      inputRef.current?.focus();
      return;
    }
    onDone(iso);
  }

  return (
    <ModalFrame
      labelledBy={titleId}
      onCancel={() => onDone(null)}
      initialFocus={activeRef}
      className="pick-date"
    >
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="modal__title">
          {options.title}
        </h2>
        <div className="pick-date__header">
          <button
            type="button"
            className="icon-button"
            aria-label={t('dialogs.pickDate.previousMonth')}
            onClick={() => move(addMonths(active, -1))}
          >
            <CaretLeft size={18} aria-hidden="true" focusable="false" />
          </button>
          <p id={monthId} className="pick-date__month" aria-live="polite">
            {monthLabel}
          </p>
          <button
            type="button"
            className="icon-button"
            aria-label={t('dialogs.pickDate.nextMonth')}
            onClick={() => move(addMonths(active, 1))}
          >
            <CaretRight size={18} aria-hidden="true" focusable="false" />
          </button>
          <button type="button" className="pick-date__today" onClick={() => move(today)}>
            {t('dialogs.pickDate.today')}
          </button>
        </div>
        <DatePickerGrid
          active={active}
          today={today}
          labelledBy={monthId}
          describedBy={hintId}
          activeRef={activeRef}
          onMove={move}
          onPick={(date) => onDone(formatIsoDate(date))}
        />
        <p id={hintId} className="modal__hint">
          {t('dialogs.pickDate.gridHint')}
        </p>
        <label className="modal__label" htmlFor={inputId}>
          {t('dialogs.pickDate.typedLabel')}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="text-input"
          value={typed}
          inputMode="numeric"
          onChange={(event) => onTypedChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        {error ? (
          <p id={errorId} className="modal__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--secondary" onClick={() => onDone(null)}>
            {options.cancelLabel ?? t('dialogs.cancel')}
          </button>
          <button type="submit" className="button button--primary">
            {options.confirmLabel ?? t('dialogs.pickDate.confirm')}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
