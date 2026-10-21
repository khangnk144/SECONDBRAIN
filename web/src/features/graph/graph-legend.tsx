import { useTranslation } from 'react-i18next';
import type { GraphGroup } from '../../lib/api/graph-types';

export interface GraphLegendProps {
  /** Groups present on the map, in legend order. */
  groups: readonly GraphGroup[];
  hasSources: boolean;
  hasOrphans: boolean;
}

/**
 * Legend under the map: one dot per group present (colors are the `--graph-*` tokens, see
 * graph.css), a hollow dot for documents and a line explaining faded orphan dots.
 */
export function GraphLegend({ groups, hasSources, hasOrphans }: GraphLegendProps) {
  const { t } = useTranslation();
  if (groups.length === 0) return null;
  return (
    <div
      className="graph-legend"
      role="group"
      aria-label={t('graph.legend.label')}
      data-graph-overlay
    >
      <ul className="graph-legend__list">
        {groups.map((group) => (
          <li key={group} className="graph-legend__item" data-group={group}>
            <span className={`graph-legend__dot graph-legend__dot--${group}`} aria-hidden="true" />
            {t(`graph.legend.${group}`)}
          </li>
        ))}
        {hasSources ? (
          <li className="graph-legend__item" data-group="source">
            <span className="graph-legend__dot graph-legend__dot--source" aria-hidden="true" />
            {t('graph.legend.source')}
          </li>
        ) : null}
      </ul>
      {hasOrphans ? <p className="graph-legend__note">{t('graph.legend.orphan')}</p> : null}
    </div>
  );
}
