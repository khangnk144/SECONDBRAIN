import { Sparkle } from '@phosphor-icons/react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { showToast } from '../../lib/toast-store';
import type { AiEditorAction } from './ai-action-kinds';
import { wordDiff } from './word-diff';

export function AiProposalLabel() {
  const { t } = useTranslation();
  return (
    <p className="ai-panel__proposal">
      <Sparkle size={16} aria-hidden="true" />
      <span>{t('ai-actions.panel.proposal')}</span>
    </p>
  );
}

async function copyText(text: string, t: (key: string) => string): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard');
    await navigator.clipboard.writeText(text);
    showToast({ message: t('ai-actions.panel.copied') });
  } catch {
    showToast({ message: t('ai-actions.panel.copyFailed'), tone: 'error' });
  }
}

/** The rewrite against the selection: removed words struck through, added ones marked. */
function RewriteDiff({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation();
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <p className="ai-panel__text" aria-label={t('ai-actions.panel.diffLabel')}>
      {parts.map((part, index) =>
        part.kind === 'same' ? (
          <span key={index}>{part.text}</span>
        ) : part.kind === 'removed' ? (
          <del key={index} className="ai-panel__removed">
            <span className="visually-hidden">{t('ai-actions.panel.removed')} </span>
            {part.text}
          </del>
        ) : (
          <ins key={index} className="ai-panel__added">
            <span className="visually-hidden">{t('ai-actions.panel.added')} </span>
            {part.text}
          </ins>
        ),
      )}
    </p>
  );
}

interface AiTextResultProps {
  action: AiEditorAction;
  text: string;
  /** The selection as sent (for the rewrite's diff). */
  selection: string;
  onInsertBelow: () => void;
  onReplace: () => void;
}

/**
 * Summary, explanation or rewrite, labelled as AI's. Summary and explanation: "Chèn bên dưới"
 * (a quoted, labelled paragraph), "Sao chép". Rewrite: "Thay đoạn đã chọn" first.
 */
export function AiTextResult({
  action,
  text,
  selection,
  onInsertBelow,
  onReplace,
}: AiTextResultProps) {
  const { t } = useTranslation();
  const rewrite = action === 'improve';
  return (
    <>
      <AiProposalLabel />
      {rewrite ? (
        <RewriteDiff before={selection} after={text} />
      ) : (
        <p className="ai-panel__text">{text}</p>
      )}
      <div className="ai-panel__actions">
        {rewrite ? (
          <button
            type="button"
            className="button button--primary"
            data-autofocus
            onClick={onReplace}
          >
            {t('ai-actions.panel.replace')}
          </button>
        ) : null}
        <button
          type="button"
          className={rewrite ? 'button button--secondary' : 'button button--primary'}
          data-autofocus={rewrite ? undefined : true}
          onClick={onInsertBelow}
        >
          {t('ai-actions.panel.insertBelow')}
        </button>
        <button
          type="button"
          className="button button--secondary"
          onClick={() => void copyText(text, t)}
        >
          {t('ai-actions.panel.copy')}
        </button>
      </div>
    </>
  );
}
