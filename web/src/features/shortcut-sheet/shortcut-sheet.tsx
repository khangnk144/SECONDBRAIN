import { useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useShortcutSheetUi } from '../../lib/shortcut-sheet-store';
import { ModalFrame } from '../dialogs/modal-frame';
import { KeyChips } from './key-chips';
import { shortcutSheetGroups } from './shortcut-sheet-groups';
import './shortcut-sheet.css';

/** Mounted once by the layout; `Ctrl+/` or the palette command opens it. */
export function ShortcutSheet() {
  const isOpen = useShortcutSheetUi((state) => state.isOpen);
  return isOpen ? <ShortcutSheetDialog /> : null;
}

/**
 * The shortcut sheet (SPEC F22.2): every key the app answers to, read from the registries when it
 * opens, in groups, keys as `<kbd>` chips. Esc or "Đóng" closes it; focus is trapped inside and
 * returns where it was. The list itself takes focus first so arrow keys scroll it.
 */
function ShortcutSheetDialog() {
  const { t } = useTranslation();
  const titleId = useId();
  const groupId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const groups = useMemo(() => shortcutSheetGroups(), []);
  const close = () => useShortcutSheetUi.getState().close();

  return (
    <ModalFrame
      labelledBy={titleId}
      onCancel={close}
      initialFocus={listRef}
      className="shortcut-sheet"
    >
      <div className="shortcut-sheet__header">
        <h2 id={titleId} className="modal__title">
          {t('shortcut-sheet.title')}
        </h2>
        <button type="button" className="button button--secondary" onClick={close}>
          {t('shortcut-sheet.close')}
        </button>
      </div>
      <p className="modal__hint">{t('shortcut-sheet.intro')}</p>
      <div
        ref={listRef}
        className="shortcut-sheet__groups"
        role="region"
        aria-label={t('shortcut-sheet.listLabel')}
        tabIndex={0}
      >
        {groups.map((group) => (
          <section
            key={group.id}
            className="shortcut-sheet__group"
            aria-labelledby={`${groupId}-${group.id}`}
          >
            <h3 id={`${groupId}-${group.id}`} className="shortcut-sheet__group-title">
              {t(group.titleKey)}
            </h3>
            <ul className="shortcut-sheet__rows">
              {group.rows.map((row) => (
                <li key={row.id} className="shortcut-sheet__row">
                  <span className="shortcut-sheet__label">{t(row.labelKey)}</span>
                  <KeyChips keys={row.keys} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ModalFrame>
  );
}
