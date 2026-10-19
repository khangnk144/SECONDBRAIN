import { X } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchUi } from '../../lib/search-ui-store';
import type { PropertyEntry } from './frontmatter-values';
import { propertyLabel, propertyValueText, tagList } from './property-format';
import { PropertyPopover } from './property-popover';
import { PropertyValueEditor } from './property-value-editor';

interface PropertyChipProps {
  entry: PropertyEntry;
  disabled: boolean;
  onCommit: (key: string, value: unknown) => void;
  onRemove: (entry: PropertyEntry) => void;
}

/** One property: "<label> <value>"; click edits, × removes, tag pills open the tag search. */
export function PropertyChip({ entry, disabled, onCommit, onRemove }: PropertyChipProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const label = propertyLabel(t, entry.key);
  const isTags = entry.kind === 'tags';
  const text = isTags ? '' : propertyValueText(t, entry, i18n.language);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div ref={boundary} className="property-chip" data-kind={entry.kind} data-key={entry.key}>
      <button
        ref={button}
        type="button"
        className="property-chip__main"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="property-chip__label">{label}</span>
        {/* "Hạn chót 05/11/2026": a real space, so the name reads well (no dot, design.md §7). */}
        {text !== '' ? ' ' : null}
        {text !== '' ? <span className="property-chip__value">{text}</span> : null}
      </button>
      {isTags
        ? tagList(entry.value).map((tag) => (
            <button
              key={tag}
              type="button"
              className="property-tag"
              aria-label={t('properties.searchTag', { tag })}
              onClick={() => useSearchUi.getState().openSearch(`tag:${tag}`)}
            >
              #{tag}
            </button>
          ))
        : null}
      {disabled ? null : (
        <button
          type="button"
          className="property-chip__remove"
          aria-label={t('properties.remove', { label })}
          onClick={() => onRemove(entry)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {open && !disabled ? (
        <PropertyPopover
          label={t('properties.editTitle', { label })}
          boundaryRef={boundary}
          onClose={close}
        >
          <PropertyValueEditor
            entry={entry}
            label={label}
            onCommit={(value, done) => {
              onCommit(entry.key, value);
              if (done) close();
            }}
          />
        </PropertyPopover>
      ) : null}
    </div>
  );
}
