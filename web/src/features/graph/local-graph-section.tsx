import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalGraphDepth } from '../../lib/api/graph-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { navigateTo } from '../../lib/app-navigation';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';
import { PanelSection } from '../backlinks/panel-section';
import { GraphCanvas } from './graph-canvas';
import { neighborLevels, nodesAtLevel, type GraphModelNode } from './graph-model';
import { graphRoute } from './graph-selection';
import { openGraphNode } from './open-graph-node';
import { useLocalGraph, useLocalScene } from './use-local-graph';
import './graph.css';

/** Neighbours listed under the mini graph; the full map lists everything. */
const MAX_LISTED = 12;

function NeighborLinks({ nodes, label }: { nodes: GraphModelNode[]; label: string }) {
  const { t } = useTranslation();
  if (nodes.length === 0) return null;
  return (
    <>
      <ul className="panel-list" aria-label={label}>
        {nodes.slice(0, MAX_LISTED).map((node) => (
          <li key={node.id} className="panel-list__item">
            <button
              type="button"
              className="panel-link"
              {...noteLinkHandlers((newTab) => openGraphNode(node.id, { newTab }))}
            >
              <span className="panel-link__title">{node.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {nodes.length > MAX_LISTED ? (
        <p className="panel-section__note">
          {t('graph.more', { count: nodes.length - MAX_LISTED })}
        </p>
      ) : null}
    </>
  );
}

/**
 * "Bản đồ cục bộ" in the note's right panel: the note and its neighbours (depth 1, or 2 when
 * toggled) on a small static canvas that only reacts to hover, an accessible list of the same
 * neighbours, and "Mở bản đồ não" to open the full map with this note selected.
 */
export function LocalGraphSection({ path }: { path: VaultPath }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [depth, setDepth] = useState<LocalGraphDepth>(1);
  const state = useLocalGraph(path, depth, expanded);
  const local = useLocalScene(state.status === 'ready' ? state.data : null, path);
  const title = noteTitleFromPath(path);
  const lists = useMemo(() => {
    if (!local || local.center < 0) return null;
    const { model } = local.scene;
    const levels = neighborLevels(model, local.center, depth);
    return { first: nodesAtLevel(model, levels, 1), second: nodesAtLevel(model, levels, 2) };
  }, [local, depth]);

  let message: string | null = null;
  if (state.status === 'loading' && !local) message = t('graph.local.loading');
  else if (state.status === 'error') {
    message = state.notFound ? t('graph.local.notInGraph') : t('graph.local.loadError');
  } else if (local && !lists) message = t('graph.local.notInGraph');

  return (
    <PanelSection
      title={t('graph.local.title')}
      expanded={expanded}
      onToggle={() => setExpanded((value) => !value)}
    >
      <div className="local-graph">
        {message ? <p className="panel-section__note">{message}</p> : null}
        {local && lists ? (
          <>
            <GraphCanvas
              className="local-graph__canvas"
              scene={local.scene}
              firstScene
              mode="local"
              selection={null}
              reducedMotion
            />
            {lists.first.length === 0 ? (
              <p className="panel-section__note">{t('graph.local.empty', { title })}</p>
            ) : (
              <NeighborLinks
                nodes={lists.first}
                label={t('graph.local.neighborsLabel', { title })}
              />
            )}
            <label className="local-graph__toggle">
              <input
                type="checkbox"
                checked={depth === 2}
                onChange={(event) => setDepth(event.target.checked ? 2 : 1)}
              />
              {t('graph.local.showLevelTwo')}
            </label>
            {depth === 2 ? (
              <NeighborLinks nodes={lists.second} label={t('graph.local.levelTwoLabel')} />
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="button button--secondary local-graph__open"
          onClick={() => navigateTo(graphRoute(path))}
        >
          {t('graph.local.openMap')}
        </button>
      </div>
    </PanelSection>
  );
}
