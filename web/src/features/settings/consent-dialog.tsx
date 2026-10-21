import { useId, useRef } from 'react';
import { ModalFrame } from '../dialogs/modal-frame';
import type { SaveState } from './use-setting-save';

export interface ConsentList {
  label: string;
  items: string[];
}

/**
 * What turning AI (or embeddings) on sends, in plain sentences, before anything is sent (SPEC
 * F33 consent). Only "agree" turns it on; Esc, the backdrop and "later" leave it off. Focus is
 * trapped while open and returns to the control that opened it.
 */
export function ConsentDialog({
  title,
  lead,
  lists = [],
  notes,
  agreeLabel,
  laterLabel,
  state,
  onAgree,
  onLater,
}: {
  title: string;
  lead: string;
  lists?: ConsentList[];
  notes: string[];
  agreeLabel: string;
  laterLabel: string;
  /** The save started by "agree": busy while it runs, its error shown here. */
  state: SaveState;
  onAgree: () => void;
  onLater: () => void;
}) {
  const titleId = useId();
  const leadId = useId();
  const listId = useId();
  // Agreeing must be a deliberate choice: the dialog opens on "later".
  const laterRef = useRef<HTMLButtonElement>(null);
  const busy = state.kind === 'saving';
  return (
    <ModalFrame
      labelledBy={titleId}
      describedBy={leadId}
      onCancel={onLater}
      initialFocus={laterRef}
      // The buttons are at the bottom of a tall dialog: it opens at its title (small screens).
      startAtTop
      className="consent-dialog"
    >
      <h2 id={titleId} className="modal__title">
        {title}
      </h2>
      <p id={leadId} className="consent-dialog__lead">
        {lead}
      </p>
      {lists.map((list, index) => (
        <section
          key={list.label}
          className="consent-dialog__group"
          aria-labelledby={`${listId}-${index}`}
        >
          <h3 id={`${listId}-${index}`} className="consent-dialog__label">
            {list.label}
          </h3>
          <ul className="consent-dialog__list">
            {list.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      {notes.map((note) => (
        <p key={note} className="consent-dialog__note">
          {note}
        </p>
      ))}
      {state.kind === 'error' ? (
        <p className="modal__error" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="modal__actions">
        <button ref={laterRef} type="button" className="button button--secondary" onClick={onLater}>
          {laterLabel}
        </button>
        <button
          type="button"
          className="button button--primary"
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onAgree();
          }}
        >
          {agreeLabel}
        </button>
      </div>
    </ModalFrame>
  );
}
