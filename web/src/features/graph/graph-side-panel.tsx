import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphFilterMask } from './graph-filter-state';
import type { GraphModel } from './graph-model';
import { GraphNodeDetails } from './graph-node-details';
import { GraphNodeSearch } from './graph-node-search';
import type { GraphSelection } from './graph-selection';

export interface GraphSidePanelProps {
  model: GraphModel | null;
  selection: GraphSelection | null;
  onSelect: (id: string) => void;
  onDepthChange: (depth: 1 | 2) => void;
  onOpen: (id: string) => void;
  onClear: () => void;
  /** "AI vừa cập nhật" (shown under the search box when the AI touched the vault). */
  aiTouch?: ReactNode;
  /** Active filter (F24.2): the lists show only its matches. */
  filter?: GraphFilterMask | null;
  /** Notes edited in the last 24 h (F24.3), marked in every list. */
  recent?: ReadonlySet<string> | null;
}

/**
 * Keyboard and screen-reader path through the brain map (SPEC F16, design.md screen 6): find a
 * node, read its neighbours, open it, without the canvas. Selection changes are announced.
 */
export function GraphSidePanel(props: GraphSidePanelProps) {
  const { model, selection, onSelect } = props;
  const { t } = useTranslation();
  const index = selection && model ? (model.indexById.get(selection.id) ?? -1) : -1;
  const node = model?.nodes[index];
  const announcement =
    node && model
      ? t('graph.panel.selected', {
          title: node.title,
          count: model.neighbors[node.i]?.length ?? 0,
        })
      : '';

  return (
    <aside className="graph-panel" aria-label={t('graph.panel.label')}>
      <GraphNodeSearch
        model={model}
        onSelect={onSelect}
        filter={props.filter}
        recent={props.recent}
      />
      {props.aiTouch}
      <p role="status" className="visually-hidden">
        {announcement}
      </p>
      {model && selection && node ? (
        <GraphNodeDetails
          model={model}
          selection={selection}
          onSelect={onSelect}
          onDepthChange={props.onDepthChange}
          onOpen={props.onOpen}
          onClear={props.onClear}
          recent={props.recent}
        />
      ) : (
        <p className="graph-panel__hint">{t('graph.panel.nothingSelected')}</p>
      )}
    </aside>
  );
}
