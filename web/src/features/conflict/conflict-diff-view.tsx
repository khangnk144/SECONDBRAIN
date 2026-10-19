import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { changeCounts, lineDiff, type DiffRow } from './line-diff';

interface ConflictDiffViewProps {
  disk: string;
  mine: string;
}

const MARKERS = { same: ' ', removed: '−', added: '+' } as const;

function DiffLine({ row }: { row: Exclude<DiffRow, { kind: 'folded' }> }) {
  const { t } = useTranslation();
  return (
    <li className="conflict-diff__row" data-kind={row.kind}>
      <span className="conflict-diff__marker" aria-hidden="true">
        {MARKERS[row.kind]}
      </span>
      {/* Colour is never the only signal: the marker is shown, the kind is spoken. */}
      {row.kind === 'same' ? null : (
        <span className="visually-hidden">{t(`conflict.diff.${row.kind}`)}</span>
      )}
      <code className="conflict-diff__text">{row.text === '' ? ' ' : row.text}</code>
    </li>
  );
}

/** "So sánh": unified line diff, disk (−) against mine (+). */
export function ConflictDiffView({ disk, mine }: ConflictDiffViewProps) {
  const { t } = useTranslation();
  const rows = useMemo(() => lineDiff(disk, mine), [disk, mine]);
  const counts = changeCounts(rows);
  return (
    <section className="conflict-diff" aria-labelledby="conflict-diff-title">
      <h3 id="conflict-diff-title" className="conflict-diff__title">
        {t('conflict.diff.title')}
      </h3>
      <p className="text-small">
        {counts.added + counts.removed === 0
          ? t('conflict.diff.noChanges')
          : t('conflict.diff.summary', { added: counts.added, removed: counts.removed })}
      </p>
      <ol className="conflict-diff__rows">
        {rows.map((row, index) =>
          row.kind === 'folded' ? (
            <li key={index} className="conflict-diff__row" data-kind="folded">
              <span className="conflict-diff__marker" aria-hidden="true" />
              <span className="conflict-diff__text">
                {t('conflict.diff.folded', { count: row.count })}
              </span>
            </li>
          ) : (
            <DiffLine key={index} row={row} />
          ),
        )}
      </ol>
    </section>
  );
}
