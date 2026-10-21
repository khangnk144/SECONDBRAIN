import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { GraphAiTouchPanel } from './graph-ai-touch-panel';
import { GraphCanvas, type GraphCanvasHandle } from './graph-canvas';
import { GraphLegend } from './graph-legend';
import { indexOfPath } from './graph-model';
import { usePrefersReducedMotion } from './graph-motion';
import { nextSelection, type GraphSelection } from './graph-selection';
import { GraphSidePanel } from './graph-side-panel';
import { GraphViewControls } from './graph-view-controls';
import { KEY_ZOOM_FACTOR } from './graph-viewport';
import { openGraphNode } from './open-graph-node';
import { useAiTouchPlayback } from './use-ai-touch-playback';
import { useGraphData } from './use-graph-data';
import { useGraphScene } from './use-graph-scene';
import { useGraphViewKeys } from './use-graph-view-keys';
import './graph.css';

/**
 * Brain map (`/graph`, design.md screen 6): the canvas with its legend and view controls, and
 * the side panel that offers the same exploration by keyboard. `?focus=<path>` opens with that
 * node selected; `?debug=fps` shows the frame rate.
 */
export function GraphScreen() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const focus = params.get('focus');
  const debugFps = params.get('debug') === 'fps';
  const { state, retry, reload } = useGraphData();
  const data = state.status === 'ready' ? state.data : null;
  const { scene, first } = useGraphScene(data);
  const model = scene?.model ?? null;
  const reducedMotion = usePrefersReducedMotion();
  const aiTouch = useAiTouchPlayback(model, reducedMotion, reload);
  const [selection, setSelection] = useState<GraphSelection | null>(null);
  const [fps, setFps] = useState<number | null>(null);
  const canvasRef = useRef<GraphCanvasHandle>(null);
  const appliedFocus = useRef<string | null>(null);
  // "Bỏ chọn" or Esc: the details leave the panel, so focus that was in them goes to the search box.
  const clearSelection = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof Element && active.closest('.graph-details')) {
      document.querySelector<HTMLElement>('.graph-panel [role="combobox"]')?.focus();
    }
    setSelection(null);
  }, []);
  useGraphViewKeys(canvasRef, () => {
    if (selection === null) return false;
    clearSelection();
    return true;
  });

  // Each `?focus=` value selects and centers its node once, when the map has it.
  useEffect(() => {
    if (!model || !focus || appliedFocus.current === focus) return;
    const node = model.nodes[indexOfPath(model, focus)];
    if (!node) return;
    appliedFocus.current = focus;
    setSelection({ id: node.id, depth: 1 });
    canvasRef.current?.centerOnNode(node.id);
  }, [model, focus]);

  // A refresh may have removed the selected note.
  useEffect(() => {
    if (model && selection && !model.indexById.has(selection.id)) setSelection(null);
  }, [model, selection]);

  const select = useCallback(
    (id: string) => setSelection((current) => nextSelection(current, id)),
    [],
  );
  const onFps = useCallback((value: number) => {
    setFps(value);
    console.info(`[graph] fps ${value}`);
  }, []);

  const empty = model !== null && model.nodes.length === 0;
  const loading = state.status === 'loading' || (data !== null && scene === null);

  return (
    <div className="graph-screen">
      <div className="graph-screen__stage">
        <h1 className="graph-screen__title" data-graph-overlay>
          {t('graph.title')}
        </h1>
        <GraphCanvas
          ref={canvasRef}
          className="graph-screen__canvas"
          scene={scene}
          firstScene={first}
          mode="full"
          selection={selection}
          reducedMotion={reducedMotion}
          onNodeClick={select}
          onBackgroundClick={() => setSelection(null)}
          onNodeOpen={(id) => openGraphNode(id)}
          onFps={debugFps ? onFps : undefined}
          aiTouches={aiTouch.plays}
        />
        {loading ? (
          <p role="status" className="graph-screen__message">
            {t('graph.loading')}
          </p>
        ) : null}
        {state.status === 'error' ? (
          <div role="alert" className="graph-screen__message">
            <p>{t('graph.loadError')}</p>
            <button type="button" className="button button--secondary" onClick={retry}>
              {t('graph.retry')}
            </button>
          </div>
        ) : null}
        {empty ? <p className="graph-screen__message">{t('graph.empty')}</p> : null}
        {model && !empty ? (
          <GraphViewControls
            onZoomIn={() => canvasRef.current?.zoomBy(KEY_ZOOM_FACTOR)}
            onZoomOut={() => canvasRef.current?.zoomBy(1 / KEY_ZOOM_FACTOR)}
            onReset={() => canvasRef.current?.resetView()}
          />
        ) : null}
        {model ? (
          <GraphLegend
            groups={model.groups}
            hasSources={model.hasSources}
            hasOrphans={model.hasOrphans}
          />
        ) : null}
        {debugFps && fps !== null ? (
          <output className="graph-screen__fps" data-graph-fps={fps} data-graph-overlay>
            {t('graph.debugFps', { fps })}
          </output>
        ) : null}
      </div>
      <GraphSidePanel
        model={empty ? null : model}
        selection={selection}
        onSelect={select}
        onDepthChange={(depth) =>
          setSelection((current) => (current ? { ...current, depth } : current))
        }
        onOpen={(id) => openGraphNode(id)}
        onClear={clearSelection}
        aiTouch={
          <GraphAiTouchPanel
            model={model}
            announcement={aiTouch.announcement}
            onOpen={(path) => openGraphNode(path)}
          />
        }
      />
    </div>
  );
}
