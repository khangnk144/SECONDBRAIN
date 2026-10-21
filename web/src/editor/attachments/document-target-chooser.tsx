import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalFrame } from '../../features/dialogs/modal-frame';
import { DOCUMENT_TARGETS, type DocumentTarget } from '../../lib/api/attachments-types';
import { useDocumentTargetStore, type DocumentTargetRequest } from './document-target-store';
import './document-target-chooser.css';

const FOLDER_OF: Record<DocumentTarget, string> = {
  papers: '3 Resources/papers',
  slides: '3 Resources/slides',
  other: '3 Resources/other',
};

/** Shows the first waiting "Lưu vào" request (mounted once by the note screen). */
export function DocumentTargetChooserHost() {
  const request = useDocumentTargetStore((state) => state.queue[0]);
  if (!request) return null;
  return <DocumentTargetChooser key={request.id} request={request} />;
}

function DocumentTargetChooser({ request }: { request: DocumentTargetRequest }) {
  const { t } = useTranslation();
  const titleId = useId();
  const bodyId = useId();
  const [target, setTarget] = useState<DocumentTarget>(request.initial);
  const selectedRef = useRef<HTMLInputElement>(null);
  const answer = (value: DocumentTarget | null) =>
    useDocumentTargetStore.getState().answer(request.id, value);
  const names = request.names;
  const body =
    names.length === 1
      ? t('attachments.chooser.one', { name: names[0] })
      : t('attachments.chooser.many', { count: names.length, names: names.join(', ') });

  return (
    <ModalFrame
      labelledBy={titleId}
      describedBy={bodyId}
      onCancel={() => answer(null)}
      initialFocus={selectedRef}
      className="target-chooser"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          answer(target);
        }}
      >
        <h2 id={titleId} className="modal__title">
          {t('attachments.chooser.title')}
        </h2>
        <p id={bodyId} className="modal__body target-chooser__files">
          {body}
        </p>
        <div className="target-chooser__options" role="radiogroup" aria-labelledby={titleId}>
          {DOCUMENT_TARGETS.map((option) => (
            <label key={option} className="target-chooser__option">
              <input
                ref={option === target ? selectedRef : undefined}
                type="radio"
                name={`target-${request.id}`}
                value={option}
                checked={option === target}
                onChange={() => setTarget(option)}
              />
              <span className="target-chooser__label">{t(`attachments.chooser.${option}`)}</span>
              <span className="target-chooser__folder">{FOLDER_OF[option]}</span>
            </label>
          ))}
        </div>
        <div className="modal__actions">
          <button type="button" className="button button--secondary" onClick={() => answer(null)}>
            {t('attachments.chooser.cancel')}
          </button>
          <button type="submit" className="button button--primary">
            {t('attachments.chooser.save')}
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
