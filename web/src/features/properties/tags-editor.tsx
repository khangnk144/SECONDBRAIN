import { X } from '@phosphor-icons/react';
import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTags } from '../../lib/api/search-api';
import type { TagCount } from '../../lib/api/search-types';
import { foldText } from '../../lib/fold-text';

const MAX_SUGGESTIONS = 8;

/** A tag as typed: no leading `#`, spaces become `-` (tags cannot hold spaces). */
export function cleanTag(text: string): string {
  return text.trim().replace(/^#+/, '').trim().replace(/\s+/g, '-');
}

interface TagsEditorProps {
  label: string;
  tags: string[];
  /** Called with the whole new list after each add or remove (each one is saved). */
  onChange: (tags: string[]) => void;
}

/** Chip editor for `tags`: remove buttons, a field with autocomplete from the vault's tags. */
export function TagsEditor({ label, tags, onChange }: TagsEditorProps) {
  const { t } = useTranslation();
  const id = useId();
  const [local, setLocal] = useState(tags);
  const [text, setText] = useState('');
  const [known, setKnown] = useState<TagCount[]>([]);
  const tagsKey = tags.join('\u0000');

  // Show changes at once; the saved front matter catches up when the patch answers.
  useEffect(() => setLocal(tagsKey === '' ? [] : tagsKey.split('\u0000')), [tagsKey]);
  useEffect(() => {
    let alive = true;
    getTags()
      .then((response) => alive && setKnown(response.tags))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const has = (tag: string) => local.some((existing) => foldText(existing) === foldText(tag));
  const suggestions = useMemo(() => {
    const folded = foldText(cleanTag(text));
    if (folded === '') return [];
    return known
      .filter((tag) => tag.norm.includes(folded) || foldText(tag.tag).includes(folded))
      .filter((tag) => !local.some((existing) => foldText(existing) === foldText(tag.tag)))
      .slice(0, MAX_SUGGESTIONS);
  }, [known, text, local]);

  const commit = (next: string[]) => {
    setLocal(next);
    onChange(next);
  };
  const add = (raw: string) => {
    const tag = cleanTag(raw);
    setText('');
    if (tag !== '' && !has(tag)) commit([...local, tag]);
  };

  return (
    <div className="property-tags-editor">
      {local.length > 0 ? (
        <ul className="property-tags-editor__list" aria-label={t('properties.currentTags')}>
          {local.map((tag) => (
            <li key={tag} className="property-tag property-tag--removable">
              <span>#{tag}</span>
              <button
                type="button"
                className="property-tag__remove"
                aria-label={t('properties.removeTag', { tag })}
                onClick={() => commit(local.filter((existing) => existing !== tag))}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form
        className="property-form"
        onSubmit={(event) => {
          event.preventDefault();
          add(text);
        }}
      >
        <label className="property-form__label" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="text-input"
          type="text"
          value={text}
          placeholder={t('properties.tagPlaceholder')}
          onChange={(event) => setText(event.target.value)}
        />
        <button type="submit" className="button button--secondary">
          {t('properties.addTag')}
        </button>
      </form>
      {suggestions.length > 0 ? (
        <ul className="property-choices" aria-label={t('properties.tagSuggestions')}>
          {suggestions.map((tag) => (
            <li key={tag.norm}>
              <button
                type="button"
                className="property-choices__option"
                onClick={() => add(tag.tag)}
              >
                #{tag.tag}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
