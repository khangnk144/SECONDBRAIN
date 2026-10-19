import { FolderSimple } from '@phosphor-icons/react';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import type { PickFolderDialogOptions } from '../../lib/dialogs/dialog-requests';
import { useTreeStore } from '../../lib/tree-store';
import { filterFolderOptions, folderOptions } from './folder-options';
import { ModalFrame } from './modal-frame';
import { useListboxNavigation } from './use-listbox-navigation';

/** Searchable folder list (combobox + listbox); disabled folders are shown but not choosable. */
export function PickFolderDialogView({
  options,
  onDone,
}: {
  options: PickFolderDialogOptions;
  onDone: (path: VaultPath | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const root = useTreeStore((state) => state.tree?.root ?? null);
  const [query, setQuery] = useState('');
  const rootLabel = t('dialogs.rootFolder');
  const all = useMemo(() => folderOptions(root, options.includeRoot === true), [root, options]);
  const shown = filterFolderOptions(all, query, rootLabel);
  const isDisabled = (path: VaultPath) => options.isDisabled?.(path) ?? false;
  const choose = (index: number) => {
    const option = shown[index];
    if (option && !isDisabled(option.path)) onDone(option.path);
  };
  const { activeIndex, setActiveIndex, onKeyDown } = useListboxNavigation(shown.length, choose);
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <ModalFrame
      labelledBy={titleId}
      onCancel={() => onDone(null)}
      initialFocus={inputRef}
      className="modal--picker"
    >
      <h2 id={titleId} className="modal__title">
        {options.title}
      </h2>
      <input
        ref={inputRef}
        className="text-input"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        aria-label={t('dialogs.filterFolders')}
        placeholder={t('dialogs.filterFolders')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <ul id={listId} className="picker-list" role="listbox" aria-labelledby={titleId}>
        {shown.map((option, index) => {
          const disabled = isDisabled(option.path);
          return (
            <li
              key={option.path || '/'}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={disabled || undefined}
              className={
                index === activeIndex ? 'picker-list__item is-active' : 'picker-list__item'
              }
              style={{
                paddingInlineStart: `calc(var(--space-3) + ${option.depth} * var(--space-4))`,
              }}
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <FolderSimple size={16} aria-hidden="true" focusable="false" />
              <span>{option.path === '' ? rootLabel : option.name}</span>
            </li>
          );
        })}
      </ul>
      {shown.length === 0 ? <p className="modal__body">{t('dialogs.noFolders')}</p> : null}
      <div className="modal__actions">
        <button type="button" className="button button--secondary" onClick={() => onDone(null)}>
          {options.cancelLabel ?? t('dialogs.cancel')}
        </button>
        <button
          type="button"
          className="button button--primary"
          disabled={activeIndex < 0 || isDisabled(shown[activeIndex]?.path ?? '')}
          onClick={() => choose(activeIndex)}
        >
          {options.confirmLabel}
        </button>
      </div>
    </ModalFrame>
  );
}
