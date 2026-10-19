import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConfirmDialogOptions } from '../../lib/dialogs/dialog-requests';
import { ModalFrame } from './modal-frame';

export function ConfirmDialogView({
  options,
  onDone,
}: {
  options: ConfirmDialogOptions;
  onDone: (confirmed: boolean) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const itemsId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const items = options.items ?? [];

  return (
    <ModalFrame
      role={options.danger ? 'alertdialog' : 'dialog'}
      labelledBy={titleId}
      describedBy={options.body ? bodyId : undefined}
      onCancel={() => onDone(false)}
      // Destructive actions start on Cancel, so Enter never deletes by accident.
      initialFocus={options.danger ? cancelRef : confirmRef}
    >
      <h2 id={titleId} className="modal__title">
        {options.title}
      </h2>
      {options.body ? (
        <p id={bodyId} className="modal__body">
          {options.body}
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="modal__items-block">
          {options.itemsLabel ? (
            <h3 id={itemsId} className="modal__items-label">
              {options.itemsLabel}
            </h3>
          ) : null}
          <ul
            className="modal__items"
            // Long lists scroll; keyboard users need to be able to focus them to scroll.
            tabIndex={0}
            aria-labelledby={options.itemsLabel ? itemsId : undefined}
          >
            {items.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="modal__actions">
        <button
          ref={cancelRef}
          type="button"
          className="button button--secondary"
          onClick={() => onDone(false)}
        >
          {options.cancelLabel ?? t('dialogs.cancel')}
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={options.danger ? 'button button--danger' : 'button button--primary'}
          onClick={() => onDone(true)}
        >
          {options.confirmLabel}
        </button>
      </div>
    </ModalFrame>
  );
}
