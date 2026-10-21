import { useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { AiStatus } from '../../lib/api/ai-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { aiErrorView } from '../ai-actions/ai-error-message';
import { PlacementProposal } from './placement-proposal';
import type { RowState } from './use-placement-rows';

interface InboxNoteRowProps {
  path: VaultPath;
  title: string;
  /** Undefined while it is being read. */
  line: string | undefined;
  row: RowState;
  /** AI is busy with another note (one request at a time). */
  busyElsewhere: boolean;
  status: AiStatus | null;
  /** "Áp dụng" is the dialog's one primary button (the one-note dialog). */
  primaryApply?: boolean;
  onSuggest: () => void;
  onCancel: () => void;
  onToggle: (part: 'move' | 'rename') => void;
  onApply: () => void;
  onSkip: () => void;
}

/** One Inbox note: title, first line, and what AI proposed for it (if she asked). */
export function InboxNoteRow(props: InboxNoteRowProps) {
  const { title, line, row, busyElsewhere, status } = props;
  const { t, i18n } = useTranslation();
  const id = useId();
  const element = useRef<HTMLLIElement>(null);
  const result = useRef<HTMLParagraphElement>(null);

  // The control she used was replaced by the row's next step: focus moves on to it (the outcome
  // sentence, else the first control), never left on the page body. Focus elsewhere stays put.
  useEffect(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const next =
      result.current ??
      element.current?.querySelector<HTMLElement>('input:not([disabled]), button');
    next?.focus();
  }, [row.kind]);

  const body = (() => {
    switch (row.kind) {
      case 'idle':
        return (
          <button
            type="button"
            className="button button--secondary"
            aria-label={t('ai-actions.inbox.suggestFor', { title })}
            aria-disabled={busyElsewhere || undefined}
            aria-describedby={busyElsewhere ? `${id}-busy` : undefined}
            onClick={() => {
              if (!busyElsewhere) props.onSuggest();
            }}
          >
            {t('ai-actions.inbox.suggest')}
          </button>
        );
      case 'loading':
        return (
          <div className="inbox-tidy__actions">
            <p role="status" className="inbox-tidy__status">
              {t('ai-actions.inbox.asking')}
            </p>
            <button type="button" className="button button--secondary" onClick={props.onCancel}>
              {t('ai-actions.panel.cancel')}
            </button>
          </div>
        );
      case 'error': {
        const view = aiErrorView(row.error, status, t, i18n.language);
        return (
          <div className="inbox-tidy__actions">
            <p role="alert" className="inbox-tidy__status">
              {t(view.key, view.values)}
            </p>
            {view.retry ? (
              <button
                type="button"
                className="button button--secondary"
                aria-disabled={busyElsewhere || undefined}
                onClick={() => {
                  if (!busyElsewhere) props.onSuggest();
                }}
              >
                {t('ai-actions.panel.retry')}
              </button>
            ) : null}
          </div>
        );
      }
      case 'keep':
        return (
          <>
            <p ref={result} tabIndex={-1} className="inbox-tidy__status">
              {t('ai-actions.inbox.keep')}
            </p>
            {row.reason ? <p className="inbox-tidy__reason">{row.reason}</p> : null}
          </>
        );
      case 'proposal':
        return (
          <PlacementProposal
            row={row}
            primary={props.primaryApply === true}
            onToggle={props.onToggle}
            onApply={props.onApply}
            onSkip={props.onSkip}
          />
        );
      case 'applied':
        return (
          <p ref={result} tabIndex={-1} role="status" className="inbox-tidy__status">
            {t('ai-actions.inbox.applied', { path: row.path.replace(/\.md$/i, '') })}
          </p>
        );
      case 'skipped':
        return (
          <p ref={result} tabIndex={-1} className="inbox-tidy__status">
            {t('ai-actions.inbox.skipped')}
          </p>
        );
    }
  })();

  return (
    <li ref={element} className="inbox-tidy__row">
      <div className="inbox-tidy__note">
        <span className="inbox-tidy__title">{title}</span>
        {line !== undefined ? (
          <span className="inbox-tidy__line">{line || t('ai-actions.inbox.emptyNote')}</span>
        ) : null}
      </div>
      {body}
      {busyElsewhere && row.kind === 'idle' ? (
        <span id={`${id}-busy`} hidden>
          {t('ai-actions.inbox.busy')}
        </span>
      ) : null}
    </li>
  );
}
