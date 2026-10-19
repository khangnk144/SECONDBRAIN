import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DATE_KEYS,
  KNOWN_KEYS,
  PROPERTY_KEY_PATTERN,
  STATUS_VALUES,
  TYPE_VALUES,
} from './frontmatter-values';
import { propertyLabel, statusLabel, typeLabel } from './property-format';

interface AddPropertyFormProps {
  existingKeys: string[];
  onAdd: (key: string, value: unknown) => void;
}

/** Typed value for a new key: tags split on commas, `course` becomes a wikilink. */
export function newPropertyValue(key: string, text: string): unknown {
  const trimmed = text.trim();
  if (key === 'tags') {
    return trimmed
      .split(',')
      .map((tag) => tag.trim().replace(/^#+/, '').replace(/\s+/g, '-'))
      .filter(Boolean);
  }
  if (key === 'course' && trimmed !== '' && !trimmed.startsWith('[[')) return `[[${trimmed}]]`;
  return trimmed;
}

/** "+ Thêm thuộc tính": a key (with the known keys suggested) and its first value. */
export function AddPropertyForm({ existingKeys, onAdd }: AddPropertyFormProps) {
  const { t } = useTranslation();
  const id = useId();
  const [key, setKey] = useState('');
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const cleanKey = key.trim();
  const choices =
    cleanKey === 'status'
      ? STATUS_VALUES.map((v) => ({ value: v, label: statusLabel(t, v) }))
      : cleanKey === 'type'
        ? TYPE_VALUES.map((v) => ({ value: v, label: typeLabel(t, v) }))
        : null;

  const submit = () => {
    if (!PROPERTY_KEY_PATTERN.test(cleanKey)) return setProblem(t('properties.invalidKey'));
    if (existingKeys.includes(cleanKey)) return setProblem(t('properties.duplicateKey'));
    onAdd(
      cleanKey,
      newPropertyValue(cleanKey, choices && text === '' ? (choices[0]?.value ?? '') : text),
    );
  };

  return (
    <form
      className="property-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="property-form__label" htmlFor={`${id}-key`}>
        {t('properties.newKey')}
      </label>
      <input
        id={`${id}-key`}
        className="text-input"
        type="text"
        list={`${id}-keys`}
        value={key}
        aria-invalid={problem !== null}
        aria-describedby={problem ? `${id}-problem` : undefined}
        onChange={(event) => {
          setKey(event.target.value);
          setProblem(null);
        }}
      />
      <datalist id={`${id}-keys`}>
        {KNOWN_KEYS.filter((known) => !existingKeys.includes(known)).map((known) => (
          <option key={known} value={known} label={propertyLabel(t, known)} />
        ))}
      </datalist>
      <label className="property-form__label" htmlFor={`${id}-value`}>
        {t('properties.newValue')}
      </label>
      {choices ? (
        <select
          id={`${id}-value`}
          className="text-input"
          value={text || choices[0]?.value}
          onChange={(event) => setText(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={`${id}-value`}
          className="text-input"
          type={DATE_KEYS.has(cleanKey) ? 'date' : 'text'}
          value={text}
          placeholder={cleanKey === 'tags' ? t('properties.listHint') : undefined}
          onChange={(event) => setText(event.target.value)}
        />
      )}
      {problem ? (
        <p id={`${id}-problem`} className="property-form__problem" role="alert">
          {problem}
        </p>
      ) : null}
      <button type="submit" className="button button--primary">
        {t('properties.add')}
      </button>
    </form>
  );
}
