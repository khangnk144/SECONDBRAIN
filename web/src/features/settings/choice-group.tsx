import type { ReactNode } from 'react';

export interface Choice<T extends string | number> {
  value: T;
  label: string;
  /** Shown before the label (the palette swatch). */
  adornment?: ReactNode;
}

/**
 * A few mutually exclusive options as real radio buttons in a fieldset (arrow keys move between
 * them, the legend names the group). Saves on change, like every Settings control.
 */
export function ChoiceGroup<T extends string | number>({
  name,
  legend,
  value,
  choices,
  onChange,
  status,
}: {
  name: string;
  legend: string;
  value: T;
  choices: readonly Choice<T>[];
  onChange: (value: T) => void;
  status?: ReactNode;
}) {
  return (
    <fieldset className="settings-choices">
      <legend className="settings-field__label">{legend}</legend>
      <div className="settings-choices__options">
        {choices.map((choice) => (
          <label key={String(choice.value)} className="settings-choice">
            <input
              type="radio"
              name={name}
              value={String(choice.value)}
              checked={choice.value === value}
              onChange={() => onChange(choice.value)}
            />
            {choice.adornment}
            <span>{choice.label}</span>
          </label>
        ))}
        {status}
      </div>
    </fieldset>
  );
}
