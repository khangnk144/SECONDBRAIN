import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { PromptDialogOptions } from '../../lib/dialogs/dialog-requests';
import { ModalFrame } from './modal-frame';

export function PromptDialogView({
  options,
  onDone,
}: {
  options: PromptDialogOptions;
  onDone: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const inputId = useId();
  const errorId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(options.initialValue ?? '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = options.validate?.(value) ?? null;
    if (problem) {
      setError(problem);
      inputRef.current?.focus();
      return;
    }
    onDone(value);
  }

  return (
    <ModalFrame labelledBy={titleId} onCancel={() => onDone(null)} initialFocus={inputRef}>
      <form onSubmit={submit} noValidate>
        <h2 id={titleId} className="modal__title">
          {options.title}
        </h2>
        <label className="modal__label" htmlFor={inputId}>
          {options.label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          className="text-input"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
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
            {options.confirmLabel}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
