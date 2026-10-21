import { useEffect, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isNotePath } from '../../lib/vault-paths';
import { neighborLevels, nodesAtLevel, type GraphModel, type GraphModelNode } from './graph-model';
import { graphFolderLabel, graphNodeNameWithFolder } from './graph-node-names';
import type { GraphSelection } from './graph-selection';

/** Neighbours listed per level; a hub's long tail is summarized. */
const MAX_LISTED = 100;

export interface GraphNodeDetailsProps {
  model: GraphModel;
  selection: GraphSelection;
  onSelect: (id: string) => void;
  onDepthChange: (depth: 1 | 2) => void;
  onOpen: (id: string) => void;
  onClear: () => void;
}

function NeighborList({
  nodes,
  onPick,
}: {
  nodes: GraphModelNode[];
  onPick: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="graph-neighbors">
        {nodes.slice(0, MAX_LISTED).map((node) => (
          <li key={node.id}>
            <button
              type="button"
              className="graph-neighbors__item"
              aria-label={graphNodeNameWithFolder(t, node)}
              onClick={() => onPick(node.id)}
            >
              <span className="graph-neighbors__title">{node.title}</span>
              <span className="graph-neighbors__folder">{graphFolderLabel(t, node)}</span>
            </button>
          </li>
        ))}
      </ul>
      {nodes.length > MAX_LISTED ? (
        <p className="graph-panel__hint">{t('graph.more', { count: nodes.length - MAX_LISTED })}</p>
      ) : null}
    </>
  );
}

/**
 * The selected node in the side panel: title, folder, its neighbours (each selects that node, so
 * the map can be walked by keyboard), the second-level toggle, "Mở ghi chú" and "Bỏ chọn".
 */
export function GraphNodeDetails(props: GraphNodeDetailsProps) {
  const { model, selection, onSelect, onDepthChange, onOpen, onClear } = props;
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const index = model.indexById.get(selection.id) ?? -1;
  const node = model.nodes[index];
  const levels = useMemo(() => neighborLevels(model, index, 2), [model, index]);
  const first = useMemo(() => nodesAtLevel(model, levels, 1), [model, levels]);
  const second = useMemo(() => nodesAtLevel(model, levels, 2), [model, levels]);

  // Picking a neighbour replaces this list: keep the keyboard user's place on the new node.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  }, [selection.id]);

  if (!node) return null;
  const pick = (id: string) => {
    focusHeading.current = true;
    onSelect(id);
  };

  return (
    <section className="graph-details" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} tabIndex={-1} className="graph-details__title">
        {node.title}
      </h2>
      <p className="graph-details__meta">
        {t('graph.panel.folder', { folder: graphFolderLabel(t, node) })}
      </p>
      {node.source || node.archived ? (
        <p className="graph-details__meta">
          {node.source ? t('graph.panel.source') : t('graph.panel.archived')}
        </p>
      ) : null}
      <div className="graph-details__actions">
        <button type="button" className="button button--primary" onClick={() => onOpen(node.id)}>
          {isNotePath(node.id) ? t('graph.panel.open') : t('graph.panel.openSource')}
        </button>
        <button type="button" className="button button--secondary" onClick={onClear}>
          {t('graph.panel.clear')}
        </button>
      </div>
      <h3 className="graph-details__heading">
        {t('graph.panel.neighborsHeading', { count: first.length })}
      </h3>
      {first.length === 0 ? (
        <p className="graph-panel__hint">{t('graph.panel.orphan')}</p>
      ) : (
        <NeighborList nodes={first} onPick={pick} />
      )}
      {second.length > 0 ? (
        <label className="graph-details__toggle">
          <input
            type="checkbox"
            checked={selection.depth === 2}
            onChange={(event) => onDepthChange(event.target.checked ? 2 : 1)}
          />
          {t('graph.panel.showLevelTwo')}
        </label>
      ) : null}
      {selection.depth === 2 && second.length > 0 ? (
        <>
          <h3 className="graph-details__heading">
            {t('graph.panel.levelTwoHeading', { count: second.length })}
          </h3>
          <NeighborList nodes={second} onPick={pick} />
        </>
      ) : null}
    </section>
  );
}
