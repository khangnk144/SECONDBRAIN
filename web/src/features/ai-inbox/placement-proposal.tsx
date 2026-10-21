import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AiProposalLabel } from '../ai-actions/ai-text-result';
import type { RowState } from './use-placement-rows';

type Proposal = Extract<RowState, { kind: 'proposal' }>;

interface PlacementProposalProps {
  row: Proposal;
  /** "Áp dụng" as the primary button (one note in the dialog; a list keeps them all quiet). */
  primary: boolean;
  onToggle: (part: 'move' | 'rename') => void;
  onApply: () => void;
  onSkip: () => void;
}

/**
 * "Chuyển đến 1 Projects/…" and "Đổi tên thành …", each with its own checkbox (checked at
 * first), the reason, "Áp dụng" (only the checked parts) and "Bỏ qua".
 */
export function PlacementProposal({
  row,
  primary,
  onToggle,
  onApply,
  onSkip,
}: PlacementProposalProps) {
  const { t } = useTranslation();
  const id = useId();
  const nothing = !row.move && !row.rename;
  const disabled = nothing || row.applying;
  return (
    <div className="inbox-tidy__proposal">
      <AiProposalLabel />
      <ul className="inbox-tidy__changes">
        {row.offersMove ? (
          <li>
            <label className="ai-panel__choice" htmlFor={`${id}-move`}>
              <input
                id={`${id}-move`}
                type="checkbox"
                checked={row.move}
                disabled={row.applying}
                onChange={() => onToggle('move')}
              />
              <span>{t('ai-actions.inbox.moveTo', { folder: row.proposal.folder })}</span>
            </label>
          </li>
        ) : null}
        {row.offersRename ? (
          <li>
            <label className="ai-panel__choice" htmlFor={`${id}-rename`}>
              <input
                id={`${id}-rename`}
                type="checkbox"
                checked={row.rename}
                disabled={row.applying}
                onChange={() => onToggle('rename')}
              />
              <span>{t('ai-actions.inbox.renameTo', { title: row.proposal.title })}</span>
            </label>
          </li>
        ) : null}
      </ul>
      {row.proposal.reason ? <p className="inbox-tidy__reason">{row.proposal.reason}</p> : null}
      <div className="inbox-tidy__actions">
        <button
          type="button"
          className={`button ${primary ? 'button--primary' : 'button--secondary'}`}
          aria-disabled={disabled || undefined}
          aria-describedby={nothing ? `${id}-nothing` : undefined}
          onClick={() => {
            if (!disabled) onApply();
          }}
        >
          {t('ai-actions.inbox.apply')}
        </button>
        <button type="button" className="button button--secondary" onClick={onSkip}>
          {t('ai-actions.inbox.skip')}
        </button>
        {nothing ? (
          <span id={`${id}-nothing`} className="inbox-tidy__hint">
            {t('ai-actions.inbox.nothingChecked')}
          </span>
        ) : null}
      </div>
    </div>
  );
}
