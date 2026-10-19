import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface TextValueFormProps {
  label: string;
  initial: string;
  inputType?: 'text' | 'date';
  /** Translated hint under the field (e.g. "Ngăn cách bằng dấu phẩy"). */
  hint?: string;
  onSubmit: (text: string) => void;
}

/** One field and a "Lưu" button; Enter saves, `Esc` (handled by the popover) cancels. */
export function TextValueForm({
  label,
  initial,
  inputType = 'text',
  hint,
  onSubmit,
}: TextValueFormProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(initial);
  const id = useId();
  return (
    <form
      className="property-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(text);
      }}
    >
      <label className="property-form__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="text-input"
        type={inputType}
        value={text}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(event) => setText(event.target.value)}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-small">
          {hint}
        </p>
      ) : null}
      <button type="submit" className="button button--primary">
        {t('properties.save')}
      </button>
    </form>
  );
}
