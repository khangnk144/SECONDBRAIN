import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { changeCounts, lineDiff, type DiffRow } from '../conflict/line-diff';
import '../conflict/conflict-screen.css';

export interface HistoryDiffViewProps {
  /** The note as it is now on disk. */
  current: string;
  /** The text of the selected version. */
  version: string;
}

const MARKERS = { same: ' ', removed: '−', added: '+' } as const;

/**
 * What restoring the selected version would change, as a unified line diff from the current note
 * (−: lines that would go) to that version (+: lines that would come back). Same look as the
 * conflict screen's "So sánh".
 */
export function HistoryDiffView({ current, version }: HistoryDiffViewProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => lineDiff(current, version), [current, version]);
  const counts = changeCounts(rows);
  return (
    <div className="conflict-diff history-diff">
      <p className="text-small">
        {counts.added + counts.removed === 0
          ? t('history.diff.same')
          : t('history.diff.summary', {
              added: t('history.diff.summaryAdded', { count: counts.added }),
              removed: t('history.diff.summaryRemoved', { count: counts.removed }),
            })}
      </p>
      <ol className="conflict-diff__rows" aria-label={t('history.diff.label')}>
        {rows.map((row: DiffRow, index) =>
          row.kind === 'folded' ? (
            <li key={index} className="conflict-diff__row" data-kind="folded">
              <span className="conflict-diff__marker" aria-hidden="true" />
              <span className="conflict-diff__text">
                {t('history.diff.folded', { count: row.count })}
              </span>
            </li>
          ) : (
            <li key={index} className="conflict-diff__row" data-kind={row.kind}>
              <span className="conflict-diff__marker" aria-hidden="true">
                {MARKERS[row.kind]}
              </span>
              {row.kind === 'same' ? null : (
                <span className="visually-hidden">{t(`history.diff.${row.kind}`)}</span>
              )}
              <code className="conflict-diff__text">{row.text === '' ? ' ' : row.text}</code>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
