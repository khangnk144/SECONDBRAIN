import { describe, expect, it } from 'vitest';
import { GLOW_EXTRA_PX } from './graph-draw';
import { GraphFade, FADE_MS } from './graph-fade';
import {
  DIM_ALPHA,
  STATE_DIM,
  STATE_EMPHASIS,
  STATE_HIDDEN,
  STATE_NORMAL,
} from './graph-highlight';
import type { GraphPalette } from './graph-palette';
import { PULSE_PERIOD_MS, pulseLevel, recentNodeIndices, RECENT_MS } from './graph-pulse';
import type { GraphScene } from './graph-scene';
import { GraphView } from './graph-view';
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
const NOW = new Date(2026, 9, 22, 15, 0).getTime();
const HOUR = 3_600_000;

// A – B – C, D alone; A was edited an hour ago, C two days ago.
const IDS = ['A', 'B', 'C', 'D'].map((name) => `2 Areas/${name}.md`);
const [A, B, C, D] = IDS as [string, string, string, string];
const response = graphResponse(
  [
    graphNode(A, { mtimeMs: NOW - HOUR }),
    graphNode(B, { mtimeMs: NOW - RECENT_MS - 1 }),
    graphNode(C, { mtimeMs: NOW - 48 * HOUR }),
    graphNode(D, { group: 'daily', mtimeMs: NOW - 2 * HOUR }),
  ],
  [
    [A, B],
    [B, C],
  ],
);

function view(reducedMotion = false, scene: GraphScene = staticScene(response)) {
  const { ctx, calls } = recordingContext();
  const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
  const scheduler = manualScheduler();
  const v = new GraphView(canvas, { mode: 'full', palette: PALETTE, reducedMotion, scheduler });
  v.setSize(800, 600, 1);
  v.setScene(scene, { intro: false, fit: false });
  Object.assign(v.viewport, { scale: 1, tx: 100, ty: 300 });
  return { v, scene, calls, scheduler };
}

describe('filters on the canvas (F24.2)', () => {
  it('(F24.2) non-matching nodes dim to 20 %, edges dim when both ends do; hover still lights', () => {
    const scene = staticScene(response);
    scene.setFilter(Uint8Array.from([1, 0, 0, 1]));
    const { nodeState, nodeAlpha, edgeState } = scene.highlight;
    expect([...nodeState]).toEqual([STATE_NORMAL, STATE_DIM, STATE_DIM, STATE_NORMAL]);
    expect(nodeAlpha[1]).toBeCloseTo(DIM_ALPHA);
    // A–B keeps one matching end; B–C has none.
    expect([...edgeState]).toEqual([STATE_NORMAL, STATE_DIM]);
    scene.setHover(2);
    expect(nodeState[2]).toBe(STATE_EMPHASIS);
    scene.setHover(-1);
    scene.setFilter(null);
    expect([...nodeState]).toEqual(Array(4).fill(STATE_NORMAL));
  });

  it('(F24.2) a filter without a selection names its matches; a mask of another size is ignored', () => {
    const scene = staticScene(response);
    scene.setFilter(Uint8Array.from([0, 0, 1, 1]));
    const named = [...scene.highlight.labels.slice(0, scene.highlight.labelCount)];
    expect(named.sort()).toEqual([2, 3]);
    scene.setFilter(new Uint8Array(9));
    expect(scene.filter).toBeNull();
  });
});

describe('pulse of notes edited in the last 24 h (F24.3)', () => {
  it('(F24.3) selects exactly the notes whose mtime is within 24 h, by colour group', () => {
    const scene = staticScene(response);
    expect([...(recentNodeIndices(scene.model, NOW) ?? [])]).toEqual([0, 3]);
    expect(recentNodeIndices(scene.model, NOW + 2 * RECENT_MS)).toBeNull();
  });

  it('(F24.3) breathes on a 3 s period', () => {
    expect(pulseLevel(0)).toBeCloseTo(0);
    expect(pulseLevel(PULSE_PERIOD_MS / 2)).toBeCloseTo(1);
    expect(pulseLevel(PULSE_PERIOD_MS)).toBeCloseTo(0);
  });

  /**
   * The pulse glow paths: fills around only A (x 0) and D (x 120), wider than their normal glow
   * (A: 4.7 + 4, D: 4 + 4 px), one path per colour group.
   */
  const pulseArcs = (calls: ReturnType<typeof recordingContext>['calls']) =>
    recordedPaths(calls).filter(
      (p) =>
        p.kind === 'fill' &&
        p.arcs.length > 0 &&
        p.arcs.every((a) => [0, 120].includes(slot(a.x)) && a.r > 4.7 + GLOW_EXTRA_PX + 0.2),
    );
  /** Nodes sit 40 apart; the drift moves them at most 3 px. */
  const slot = (x: number) => Math.round(x / 40) * 40;
  const slots = (paths: ReturnType<typeof pulseArcs>) =>
    paths.flatMap((p) => p.arcs.map((a) => slot(a.x))).sort((a, b) => a - b);

  it('(F24.3) the glow grows and brightens over the period while motion is allowed', () => {
    const { v, scene, calls } = view();
    v.setRecent(recentNodeIndices(scene.model, NOW));
    const frameAt = (ms: number) => {
      calls.length = 0;
      v.renderFrame(ms);
      return pulseArcs(calls);
    };
    const rest = frameAt(0);
    // The drift clock advances by capped frame steps: walk it to mid-period.
    let top = rest;
    for (let ms = 16; ms <= PULSE_PERIOD_MS / 2; ms += 16) top = frameAt(ms);
    expect(slots(rest)).toEqual([0, 120]);
    expect(slots(top)).toEqual([0, 120]);
    expect(top[0]?.alpha ?? 0).toBeGreaterThan((rest[0]?.alpha ?? 0) + 0.15);
    expect(top[0]?.arcs[0]?.r ?? 0).toBeGreaterThan((rest[0]?.arcs[0]?.r ?? 0) + 3);
  });

  it('(F24.3) reduced motion: a still glow and a ring, the same on every frame', () => {
    const { v, scene, calls } = view(true);
    v.setRecent(recentNodeIndices(scene.model, NOW));
    v.renderFrame(0);
    const rings = recordedPaths(calls).filter(
      (p) => p.kind === 'stroke' && p.arcs.length > 0 && p.style !== PALETTE.accent,
    );
    expect(rings.flatMap((p) => p.arcs.map((a) => a.x)).sort((a, b) => a - b)).toEqual([0, 120]);
    const first = pulseArcs(calls).map((p) => [p.alpha, p.arcs.length]);
    calls.length = 0;
    v.renderFrame(1_500);
    expect(pulseArcs(calls).map((p) => [p.alpha, p.arcs.length])).toEqual(first);
  });
});

describe('change of week: fade, no layout jump (F24.1)', () => {
  const week = graphResponse(
    [graphNode(A), graphNode(B), graphNode('0 Inbox/Đã xoá.md')],
    [
      [A, B],
      [B, '0 Inbox/Đã xoá.md'],
    ],
  );

  it('(F24.1) what the week adds fades in, what it removes fades out', () => {
    const live = staticScene(response);
    const past = staticScene(week);
    const fade = GraphFade.between(live, past);
    expect(fade).not.toBeNull();
    expect([...(fade?.hiddenNodes ?? [])]).toEqual([0, 0, 1]);
    expect([...(fade?.hiddenEdges ?? [])]).toEqual([0, 1]);
    expect(GraphFade.between(live, staticScene(response))).toBeNull();
  });

  it('(F24.1) the view fades over 250 ms, then draws the week normally', () => {
    const { v, scheduler } = view();
    const past = staticScene(week);
    v.setScene(past, { intro: false, fit: false, fade: true });
    expect(past.highlight.nodeState[2]).toBe(STATE_HIDDEN);
    scheduler.flush(1_000);
    v.renderFrame(1_000 + FADE_MS / 2);
    expect(past.highlight.nodeState[2]).toBe(STATE_HIDDEN);
    v.renderFrame(1_000 + FADE_MS + 1);
    expect(past.highlight.nodeState[2]).toBe(STATE_NORMAL);
  });

  it('(F24.1) reduced motion: the week appears at once', () => {
    const { v } = view(true);
    const past = staticScene(week);
    v.setScene(past, { intro: false, fit: false, fade: true });
    expect([...past.highlight.nodeState]).not.toContain(STATE_HIDDEN);
  });
});
