import { describe, expect, it, vi } from 'vitest';
import { STATE_DIM, STATE_EMPHASIS, STATE_NORMAL } from './graph-highlight';
import { createSimulation } from './graph-layout';
import { MAX_DRIFT_PX_PER_FRAME, SIGNAL_MS } from './graph-motion';
import type { GraphPalette } from './graph-palette';
import { GraphScene } from './graph-scene';
import { GraphView, type GraphViewOptions } from './graph-view';
import {
  graphNode,
  graphResponse,
  manualScheduler,
  recordedPaths,
  recordingContext,
  staticScene,
} from './__tests__/graph-test-helpers';

const PALETTE: GraphPalette = {
  groups: ['#d88ab6', '#b9a0d6', '#5fb89e', '#f2b255', '#8a7e90', '#4a3e52'],
  background: '#1c1622',
  ink: '#f1e9f2',
  quietInk: '#a595ac',
  edge: '#a595ac',
  accent: '#d88ab6',
  font: 'Be Vietnam Pro',
};

// A – B – C – D, and E – A. Node i sits at world (40 i, 0) = screen (100 + 40 i, 300).
const IDS = ['A', 'B', 'C', 'D', 'E'].map((name) => `2 Areas/${name}.md`);
const [A, B, C, D, E] = IDS as [string, string, string, string, string];
const response = graphResponse(
  IDS.map((id) => graphNode(id)),
  [
    [A, B],
    [B, C],
    [C, D],
    [E, A],
  ],
);
const screenX = (i: number) => 100 + 40 * i;

function setup(options: Partial<GraphViewOptions> = {}) {
  const { ctx, calls } = recordingContext();
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const scheduler = manualScheduler();
  const onNodeClick = vi.fn();
  const onBackgroundClick = vi.fn();
  const onNodeOpen = vi.fn();
  const view = new GraphView(canvas, {
    mode: 'full',
    palette: PALETTE,
    reducedMotion: false,
    scheduler,
    onNodeClick,
    onBackgroundClick,
    onNodeOpen,
    ...options,
  });
  const scene = staticScene(response);
  view.setSize(800, 600, 1);
  view.setScene(scene, { intro: false, fit: true });
  Object.assign(view.viewport, { scale: 1, tx: 100, ty: 300 });
  const states = () =>
    IDS.map((id) => scene.highlight.nodeState[scene.model.indexById.get(id) ?? -1]);
  return { view, scene, calls, scheduler, onNodeClick, onBackgroundClick, onNodeOpen, states };
}

function click(view: GraphView, x: number, time: number) {
  view.input.pointerDown(x, 300);
  view.input.pointerUp(x, 300, time);
}

describe('graph canvas: hover, click, double-click (F16.3)', () => {
  it('hover: label and neighbours highlighted in the very next frame', () => {
    const { view, calls, scheduler, states } = setup();
    scheduler.flush(0);
    calls.length = 0;
    view.input.pointerMove(screenX(1) + 2, 301);
    expect(scheduler.pending()).toBe(1);
    scheduler.flush(16);
    // The hovered name in --ink (quiet hub names, in --ink-2, are covered in graph-labels).
    const labels = calls
      .filter((c) => c.method === 'fillText' && c.fillStyle === PALETTE.ink)
      .map((c) => c.args[0]);
    expect(labels).toEqual(['B']);
    expect(states()).toEqual([
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_NORMAL,
      STATE_NORMAL,
    ]);
    view.input.pointerLeave();
    expect(states()).toEqual(Array(5).fill(STATE_NORMAL));
  });

  it('click: the signal travels 300 ms, then exactly the depth-1 neighbours light up', () => {
    const { view, scene, calls, scheduler, onNodeClick, states } = setup();
    click(view, screenX(1), 1_000);
    expect(onNodeClick).toHaveBeenCalledWith(B);
    view.setSelection(B, 1);
    scheduler.flush(2_000);
    expect(states()).toEqual([STATE_DIM, STATE_EMPHASIS, STATE_DIM, STATE_DIM, STATE_DIM]);
    calls.length = 0;
    scheduler.flush(2_000 + SIGNAL_MS / 2);
    const signal = recordedPaths(calls).find(
      (p) => p.kind === 'fill' && p.arcs.length === 2 && p.arcs.every((a) => a.r === 2.5),
    );
    // Two dots halfway along B–A and B–C (give or take the drift).
    const xs = (signal?.arcs ?? []).map((a) => a.x).sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(Math.abs((xs[0] ?? 0) - 20)).toBeLessThanOrEqual(3);
    expect(Math.abs((xs[1] ?? 0) - 60)).toBeLessThanOrEqual(3);
    scheduler.flush(2_000 + SIGNAL_MS + 1);
    expect(states()).toEqual([
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_DIM,
      STATE_DIM,
    ]);
    expect(scene.highlight.nodeAlpha[3]).toBeCloseTo(0.2);

    // Second click on the same node: the next ring (D via C, E via A).
    view.setSelection(B, 2);
    scheduler.flush(3_000);
    scheduler.flush(3_000 + SIGNAL_MS + 1);
    expect(states()).toEqual(Array(5).fill(STATE_EMPHASIS));
  });

  it('double-click opens the node; a slow second click does not', () => {
    const { view, onNodeClick, onNodeOpen } = setup();
    click(view, screenX(2), 1_000);
    click(view, screenX(2), 1_250);
    expect(onNodeOpen).toHaveBeenCalledTimes(1);
    expect(onNodeOpen).toHaveBeenCalledWith(C);
    expect(onNodeClick).toHaveBeenCalledTimes(2);
    click(view, screenX(3), 5_000);
    click(view, screenX(3), 6_000);
    expect(onNodeOpen).toHaveBeenCalledTimes(1);
  });

  it('click on empty space clears; drag pans, drag on a node moves it; wheel zooms at the pointer', () => {
    const { view, scene, onBackgroundClick, onNodeClick } = setup();
    click(view, 500, 1_000);
    expect(onBackgroundClick).toHaveBeenCalledTimes(1);
    view.input.pointerDown(500, 300);
    view.input.pointerMove(530, 320);
    view.input.pointerUp(530, 320, 2_000);
    expect(view.viewport).toMatchObject({ tx: 130, ty: 320 });
    view.input.pointerDown(screenX(4) + 30, 320);
    view.input.pointerMove(screenX(4) + 80, 420);
    view.input.pointerUp(screenX(4) + 80, 420, 3_000);
    expect(scene.model.nodes[4]).toMatchObject({ x: 210, y: 100, fx: null, fy: null });
    expect(onNodeClick).not.toHaveBeenCalled();
    const before = { x: (400 - view.viewport.tx) / view.viewport.scale };
    view.input.wheel(400, 300, -100, 0);
    expect(view.viewport.scale).toBeGreaterThan(1);
    expect((400 - view.viewport.tx) / view.viewport.scale).toBeCloseTo(before.x);
  });
});

describe('graph canvas: motion', () => {
  it('intro expands from the center, then the dots drift at most 0.3 px per frame', () => {
    const { view, scene, scheduler } = setup();
    view.setScene(scene, { intro: true, fit: false });
    scheduler.flush(10_000);
    // First intro frame: every dot at the center, give or take the drift.
    expect(Math.max(...Array.from(scene.px, Math.abs))).toBeLessThanOrEqual(3);
    let previous = Float32Array.from(scene.px);
    let largest = 0;
    for (let frame = 1; frame <= 240; frame++) {
      scheduler.flush(10_000 + frame * (1000 / 60));
      if (frame > 40) {
        scene.px.forEach((x, i) => (largest = Math.max(largest, Math.abs(x - (previous[i] ?? 0)))));
      }
      previous = Float32Array.from(scene.px);
    }
    expect(scene.px[4]).toBeCloseTo(160, -1);
    expect(largest).toBeGreaterThan(0);
    expect(largest).toBeLessThanOrEqual(MAX_DRIFT_PX_PER_FRAME);
    expect(scheduler.pending()).toBe(1);
  });

  it('stops drawing while the tab is hidden and resumes when it is visible', () => {
    const { view, scheduler } = setup();
    scheduler.flush(0);
    expect(scheduler.pending()).toBe(1);
    view.setHidden(true);
    expect(scheduler.pending()).toBe(0);
    view.setHidden(false);
    expect(scheduler.pending()).toBe(1);
  });
});

describe('graph canvas: reduced motion (F16.5)', () => {
  it('no intro and no drift; highlights switch at once', () => {
    const { view, scene, scheduler, states } = setup({ reducedMotion: true });
    // A scene that still has layout heat is settled at once instead of moving on screen.
    const warm = staticScene(response);
    const simulation = createSimulation(warm.model);
    const fresh = new GraphScene(warm.model, simulation);
    view.setScene(fresh, { intro: true, fit: false });
    expect(simulation.alpha()).toBe(0);
    scheduler.flush(1_000);
    expect(Array.from(fresh.px)).toEqual(fresh.model.nodes.map((n) => Math.fround(n.x ?? 0)));
    expect(scheduler.pending()).toBe(0);

    view.setScene(scene, { intro: false, fit: false });
    view.setSelection(B, 1);
    expect(states()).toEqual([
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_EMPHASIS,
      STATE_DIM,
      STATE_DIM,
    ]);
    expect(scene.signalFrom).toBe(-1);
    scheduler.flush(2_000);
    expect(scheduler.pending()).toBe(0);
    view.input.pointerMove(screenX(3), 300);
    expect(states()[3]).toBe(STATE_NORMAL);
    expect(scheduler.pending()).toBe(1);
  });
});

describe('graph canvas: local graph mode', () => {
  it('only hovers: clicks, drags and the wheel are left alone, nothing animates', () => {
    const { view, scheduler, onNodeClick, onNodeOpen, states } = setup({ mode: 'local' });
    const before = { ...view.viewport };
    click(view, screenX(1), 1_000);
    click(view, screenX(1), 1_100);
    view.input.pointerDown(500, 300);
    view.input.pointerMove(560, 340);
    view.input.pointerUp(560, 340, 2_000);
    expect(view.input.wheel(400, 300, -100, 0)).toBe(false);
    expect(view.viewport).toEqual(before);
    expect(onNodeClick).not.toHaveBeenCalled();
    expect(onNodeOpen).not.toHaveBeenCalled();
    view.input.pointerMove(screenX(1), 300);
    expect(states()[0]).toBe(STATE_EMPHASIS);
    scheduler.flush(3_000);
    expect(scheduler.pending()).toBe(0);
  });
});
