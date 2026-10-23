import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { AiTouchPlay } from './graph-ai-touch-effect';
import { useGraphPalette } from './graph-palette';
import type { GraphScene } from './graph-scene';
import type { GraphSelection } from './graph-selection';
import { GraphView } from './graph-view';

export interface GraphCanvasHandle {
  resetView: () => void;
  zoomBy: (factor: number) => void;
  centerOnNode: (id: string) => void;
}

export interface GraphCanvasProps {
  scene: GraphScene | null;
  /** First picture of a graph: intro animation and fit to the canvas. Later scenes keep the view. */
  firstScene: boolean;
  mode: 'full' | 'local';
  selection: GraphSelection | null;
  reducedMotion: boolean;
  className?: string;
  onNodeClick?: (id: string) => void;
  onBackgroundClick?: () => void;
  onNodeOpen?: (id: string) => void;
  /** Only with `?debug=fps`. */
  onFps?: (fps: number) => void;
  /** "AI vừa chạm" playbacks (full map). */
  aiTouches?: readonly AiTouchPlay[];
  /** Filter matches of `scene`'s nodes (1 = match); the rest is dimmed (F24.2). */
  filter?: Uint8Array | null;
  /** Nodes of `scene` that pulse (edited in the last 24 h, F24.3). */
  recent?: Int32Array | null;
  /** A new scene fades in over the previous one (time scrubber; positions are shared). */
  fadeScenes?: boolean;
}

/** Areas of the canvas under its overlays (`data-graph-overlay` siblings), in canvas CSS px. */
function overlayRects(canvas: HTMLCanvasElement) {
  const origin = canvas.getBoundingClientRect();
  const overlays =
    canvas.parentElement?.querySelectorAll<HTMLElement>('[data-graph-overlay]') ?? [];
  return Array.from(overlays, (element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left - origin.left,
      y: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    };
  });
}

function localPoint(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * The graph canvas. Hidden from assistive technology (`aria-hidden`): every action it offers has
 * a keyboard path in the side panel or the local graph's list.
 */
export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(props, ref) {
    const { scene, firstScene, mode, selection, reducedMotion, className } = props;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const viewRef = useRef<GraphView | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const palette = useGraphPalette();
    const debugFps = props.onFps !== undefined;

    useEffect(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const idleCursor = mode === 'full' ? 'grab' : 'default';
      canvas.style.cursor = idleCursor;
      const view = new GraphView(canvas, {
        mode,
        palette,
        reducedMotion,
        onNodeClick: (id) => latest.current.onNodeClick?.(id),
        onBackgroundClick: () => latest.current.onBackgroundClick?.(),
        onNodeOpen: (id) => latest.current.onNodeOpen?.(id),
        onHoverChange: (id) => {
          canvas.style.cursor = id === null ? idleCursor : 'pointer';
        },
        onFps: debugFps ? (fps) => latest.current.onFps?.(fps) : undefined,
      });
      viewRef.current = view;

      const measure = () => {
        const rect = canvas.getBoundingClientRect();
        view.setSize(rect.width, rect.height, window.devicePixelRatio || 1);
        view.setLabelExclusions(overlayRects(canvas));
      };
      measure();
      const resizeObserver =
        typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
      resizeObserver?.observe(canvas);
      // Moving the window to a screen with another pixel ratio fires `resize`.
      window.addEventListener('resize', measure);
      const onVisibility = () => view.setHidden(document.visibilityState === 'hidden');
      onVisibility();
      document.addEventListener('visibilitychange', onVisibility);
      // React registers wheel listeners as passive; zooming must prevent the page scroll.
      const onWheel = (event: WheelEvent) => {
        const point = localPoint(event, canvas);
        if (view.input.wheel(point.x, point.y, event.deltaY, event.deltaMode))
          event.preventDefault();
      };
      canvas.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', measure);
        document.removeEventListener('visibilitychange', onVisibility);
        canvas.removeEventListener('wheel', onWheel);
        view.destroy();
        viewRef.current = null;
      };
      // The view is created once per canvas; later prop changes go through the effects below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode, debugFps]);

    useEffect(() => viewRef.current?.setPalette(palette), [palette]);
    useEffect(() => viewRef.current?.setReducedMotion(reducedMotion), [reducedMotion]);
    useEffect(() => {
      if (!scene) return;
      const fade = latest.current.fadeScenes === true && !firstScene;
      viewRef.current?.setScene(scene, { intro: firstScene, fit: firstScene, fade });
      // The legend and the controls appear with the first scene.
      if (canvasRef.current) viewRef.current?.setLabelExclusions(overlayRects(canvasRef.current));
    }, [scene, firstScene]);
    useEffect(() => {
      viewRef.current?.setSelection(selection?.id ?? null, selection?.depth ?? 1);
    }, [scene, selection?.id, selection?.depth]);
    const filter = props.filter ?? null;
    useEffect(() => viewRef.current?.setFilter(filter), [scene, filter]);
    const recent = props.recent ?? null;
    useEffect(() => viewRef.current?.setRecent(recent), [scene, recent]);
    const aiTouches = props.aiTouches;
    useEffect(() => {
      if (aiTouches) viewRef.current?.setAiTouches(aiTouches, Date.now());
    }, [aiTouches]);

    useImperativeHandle(
      ref,
      () => ({
        resetView: () => viewRef.current?.resetView(),
        zoomBy: (factor) => viewRef.current?.zoomBy(factor),
        centerOnNode: (id) => viewRef.current?.centerOnNode(id),
      }),
      [],
    );

    const withPoint =
      (handler: (view: GraphView, x: number, y: number, event: ReactPointerEvent) => void) =>
      (event: ReactPointerEvent<HTMLCanvasElement>) => {
        const view = viewRef.current;
        if (!view) return;
        const point = localPoint(event, event.currentTarget);
        handler(view, point.x, point.y, event);
      };

    return (
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className={className}
        onPointerDown={withPoint((view, x, y, event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          view.input.pointerDown(x, y);
        })}
        onPointerMove={withPoint((view, x, y) => view.input.pointerMove(x, y))}
        onPointerUp={withPoint((view, x, y, event) => view.input.pointerUp(x, y, event.timeStamp))}
        onPointerLeave={withPoint((view) => view.input.pointerLeave())}
        onPointerCancel={withPoint((view) => view.input.pointerCancel())}
      />
    );
  },
);
