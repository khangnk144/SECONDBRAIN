import { File, FileText } from '@phosphor-icons/react';
import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateChoice, TemplatePickerOptions } from '../../lib/dialogs/dialog-requests';
import { ModalFrame } from './modal-frame';
import { useListboxNavigation } from './use-listbox-navigation';

/** `Alt+N`: "Trống" (blank) plus every template; ↑/↓, Enter, Esc. */
export function TemplatePickerView({
  options,
  onDone,
}: {
  options: TemplatePickerOptions;
  onDone: (choice: TemplateChoice | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const entries = [
    { key: '', label: t('dialogs.template.blank'), template: null },
    ...options.templates.map((tpl) => ({ key: tpl.path, label: tpl.title, template: tpl.path })),
  ];
  const choose = (index: number) => {
    const entry = entries[index];
    if (entry) onDone({ template: entry.template });
  };
  const { activeIndex, setActiveIndex, onKeyDown } = useListboxNavigation(entries.length, choose);
  const optionId = (index: number) => `${listId}-${index}`;

  return (
    <ModalFrame
      labelledBy={titleId}
      onCancel={() => onDone(null)}
      initialFocus={listRef}
      className="modal--picker"
    >
      <h2 id={titleId} className="modal__title">
        {t('dialogs.template.title')}
      </h2>
      <p className="modal__hint">{t('dialogs.template.hint')}</p>
      <ul
        ref={listRef}
        id={listId}
        className="picker-list"
        role="listbox"
        tabIndex={0}
        aria-labelledby={titleId}
        aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
        onKeyDown={onKeyDown}
      >
        {entries.map((entry, index) => {
          const Icon = entry.template === null ? File : FileText;
          return (
            <li
              key={entry.key || 'blank'}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              className={
                index === activeIndex ? 'picker-list__item is-active' : 'picker-list__item'
              }
              onMouseMove={() => setActiveIndex(index)}
              onClick={() => choose(index)}
            >
              <Icon size={16} aria-hidden="true" focusable="false" />
              <span>{entry.label}</span>
            </li>
          );
        })}
      </ul>
      <div className="modal__actions">
        <button type="button" className="button button--secondary" onClick={() => onDone(null)}>
          {t('dialogs.cancel')}
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={() => choose(activeIndex)}
        >
          {t('dialogs.template.create')}
        </button>
      </div>
    </ModalFrame>
  );
}
