import { beforeEach, describe, expect, it } from 'vitest';
import {
  AI_TOUCH_ENTRY_MS,
  MAX_AI_TOUCH_EVENTS,
  planAiTouch,
  playAiTouches,
  recordAiTouch,
  resetAiTouchStore,
  useAiTouchStore,
} from './graph-ai-touch';
import { drawAiTouchHalos, drawAiTouchLabels } from './graph-ai-touch-draw';
import { GraphTouchEffects, type AiTouchPlay } from './graph-ai-touch-effect';
import { clearOfOverlays, nearestEdgePoint } from './graph-ai-touch-geometry';
import { STATE_EMPHASIS } from './graph-highlight';
import type { GraphPalette } from './graph-palette';
import type { Viewport } from './graph-viewport';
import {
  LABEL_CHAR_PX,
  recordedPaths,
  recordingContext,
  staticScene,
  VAULT,
  vaultGraph,
} from './__tests__/graph-test-helpers';

// vaultGraph() nodes sit at x = 0, 40, 80… in this order: hub, project, daily, pdf, other, orphan.
const HUB = 0;
const PROJECT = 1;
const PDF = 3;
const SIZE = { width: 400, height: 300, dpr: 1 };
const view = (): Viewport => ({ scale: 1, tx: 200, ty: 150, fitScale: 1 });
const START = 10_000;
const PALETTE: GraphPalette = {
  groups: ['p', 'a', 'r', 'w', 'd', 'o'],
  background: 'bg',
  ink: 'ink',
  quietInk: 'ink2',
  edge: 'edge',
  accent: 'accent',
  font: 'sans',
};

function play(source: string, outputs: string[], reducedMotion = false): AiTouchPlay {
  return {
    id: 1,
    source,
    sourceTitle: 'Bài báo',
    playback: planAiTouch(outputs, START, reducedMotion),
  };
}

/**
 * Runs one frame `ms` after the playback started. The first frame after `set` is mapped to the
 * hand-over time (`START`), so every test starts with a frame at 0.
 */
function frameAt(effects: GraphTouchEffects, scene: ReturnType<typeof staticScene>, ms: number) {
  scene.computePositions(1, null, 1);
  effects.update(scene, START + ms, view(), SIZE, true);
}

describe('"AI vừa chạm" timeline and store (F34)', () => {
  beforeEach(() => resetAiTouchStore());

  it('keeps the last five events, outputs in order without repeats', () => {
    for (let i = 0; i < MAX_AI_TOUCH_EVENTS + 2; i++)
      recordAiTouch(`s${i}.pdf`, ['a.md', 'b.md', 'a.md']);
    const { events } = useAiTouchStore.getState();
    expect(events.map((e) => e.source)).toEqual(['s2.pdf', 's3.pdf', 's4.pdf', 's5.pdf', 's6.pdf']);
    expect(events[0]?.outputs).toEqual(['a.md', 'b.md']);
  });

  it('chains two ingests: the second starts when the first lit its last page', () => {
    recordAiTouch('a.pdf', ['wiki/a.md', 'wiki/b.md']);
    recordAiTouch('b.pdf', ['wiki/c.md']);
    const ids = useAiTouchStore.getState().events.map((e) => e.id);
    playAiTouches(ids, { now: 0, reducedMotion: false, isDrawn: () => true });
    const [first, second] = useAiTouchStore.getState().events;
    expect(first?.playback?.sequence.map((s) => s.at)).toEqual([900, 1050]);
    expect(second?.playback?.startedAt).toBe(1050);
    expect(second?.playback?.sequence.map((s) => s.at)).toEqual([1950]);
  });
});

describe('"AI vừa chạm" on the canvas (F34)', () => {
  it('the nearest canvas edge point stays inside the canvas', () => {
    expect(nearestEdgePoint(320, 150, SIZE)).toEqual({ x: 384, y: 150 });
    expect(nearestEdgePoint(50, 40, SIZE)).toEqual({ x: 50, y: 16 });
    expect(nearestEdgePoint(-500, 900, SIZE)).toEqual({ x: 16, y: 284 });
  });

  it('a source on the map grows in at the nearest edge and glides to its place', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play(VAULT.pdf, [VAULT.hub, VAULT.project])], START);
    // The PDF sits at world x 120 = screen 320: the right edge (screen 384 = world 184) is nearest.
    frameAt(effects, scene, 0);
    expect(scene.px[PDF]).toBeCloseTo(184);
    expect(scene.radius[PDF]).toBeLessThan(0.1);
    frameAt(effects, scene, AI_TOUCH_ENTRY_MS / 2);
    expect(scene.px[PDF]).toBeCloseTo(184 + (120 - 184) * 0.875);
    frameAt(effects, scene, AI_TOUCH_ENTRY_MS);
    expect(scene.px[PDF]).toBeCloseTo(120);
    expect(scene.radius[PDF]).toBeCloseTo(scene.model.nodes[PDF]?.radius ?? 0);
    expect(effects.frame.plays[0]?.ghost).toBe(false);
  });

  it('signals travel in order and each output lights on arrival, emphasized and named', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play(VAULT.pdf, [VAULT.hub, VAULT.project])], START);
    frameAt(effects, scene, 0);
    frameAt(effects, scene, 700);
    const f = effects.frame.plays[0]!;
    expect(f.signal[0]).toBeCloseTo(1 / 3);
    expect(f.signal[1]).toBe(-1);
    expect(scene.touched?.[HUB]).toBe(0);
    frameAt(effects, scene, 900);
    expect(scene.touched?.[HUB]).toBe(1);
    expect(scene.touched?.[PROJECT]).toBe(0);
    expect(scene.highlight.nodeState[HUB]).toBe(STATE_EMPHASIS);
    expect(Array.from(scene.highlight.labels.slice(0, scene.highlight.labelCount))).toContain(HUB);
    frameAt(effects, scene, 1050);
    expect(scene.touched?.[PROJECT]).toBe(1);
    frameAt(effects, scene, 900 + 10_000);
    expect(scene.touched?.[HUB]).toBe(0);
    expect(scene.touched?.[PROJECT]).toBe(1);
    frameAt(effects, scene, 1050 + 10_000);
    expect(scene.touched).toBeNull();
  });

  it('a source that is not on the map is its own dot at the edge nearest the pages', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play('3 Resources/papers/Mới.pdf', [VAULT.hub, VAULT.project])], START);
    frameAt(effects, scene, 0);
    const f = effects.frame.plays[0]!;
    expect(f.ghost).toBe(true);
    // Pages at screen x 200 and 240, y 150: the top edge is nearest (y 16 → world -134).
    expect(f.sourceX).toBeCloseTo(20);
    expect(f.sourceY).toBeCloseTo(-134);
    expect(f.sourceScale).toBe(0);
  });

  it('the edge point keeps clear of the overlays (legend row, controls), like the names', () => {
    const legend = { x: 0, y: 270, width: 380, height: 30 };
    const controls = { x: 300, y: 0, width: 100, height: 40 };
    // On the legend row: just above it (the canvas bottom has no room below).
    expect(clearOfOverlays({ x: 200, y: 284 }, SIZE, [legend])).toEqual({ x: 200, y: 258 });
    // Under the zoom controls at the right edge: just below them.
    expect(clearOfOverlays({ x: 384, y: 30 }, SIZE, [controls])).toEqual({ x: 384, y: 52 });
    expect(clearOfOverlays({ x: 16, y: 150 }, SIZE, [legend, controls])).toEqual({ x: 16, y: 150 });
  });

  it('a source drawn at the edge enters off the overlays and its name avoids them too', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play('3 Resources/papers/Mới.pdf', [VAULT.hub, VAULT.project])], START);
    // Pages at screen y 150: the top edge is nearest, where a title bar overlays the canvas.
    const titleBar = { x: 0, y: 0, width: 400, height: 40 };
    scene.computePositions(1, null, 1);
    effects.update(scene, START, view(), SIZE, true, [titleBar]);
    scene.computePositions(1, null, 1);
    effects.update(scene, START + AI_TOUCH_ENTRY_MS, view(), SIZE, true, [titleBar]);
    const f = effects.frame.plays[0]!;
    expect(f.ghost).toBe(true);
    // Screen (220, 52): 12 px under the bar, instead of y 16 under it.
    expect(f.sourceX).toBeCloseTo(20);
    expect(f.sourceY).toBeCloseTo(52 - 150);
    // Another overlay right of the dot: the name goes to its left.
    const beside = { x: 228, y: 40, width: 172, height: 30 };
    const frame = {
      ...scene.frameInput(PALETTE, view(), SIZE),
      touch: effects.frame,
      labelExclusions: [titleBar, beside],
    };
    const { ctx, calls } = recordingContext();
    drawAiTouchLabels(ctx, frame);
    const text = calls.find((call) => call.method === 'fillText');
    expect(text?.args[0]).toBe('Bài báo');
    expect((text?.args[1] as number) + 'Bài báo'.length * LABEL_CHAR_PX).toBeLessThan(220);
    expect(text?.args[2]).toBeCloseTo(52);
  });

  it('under reduced motion nothing travels and every output is lit at once', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play(VAULT.pdf, [VAULT.hub, VAULT.project], true)], START);
    frameAt(effects, scene, 0);
    const f = effects.frame.plays[0]!;
    expect(Array.from(f.signal)).toEqual([-1, -1]);
    expect(Array.from(f.litAlpha)).toEqual([1, 1]);
    expect(scene.px[PDF]).toBeCloseTo(120);
  });

  it('draws an accent halo under each lit output', () => {
    const scene = staticScene(vaultGraph());
    const effects = new GraphTouchEffects();
    effects.set([play(VAULT.pdf, [VAULT.hub], true)], START);
    frameAt(effects, scene, 0);
    const frame = { ...scene.frameInput(PALETTE, view(), SIZE), touch: effects.frame };
    const { ctx, calls } = recordingContext();
    drawAiTouchHalos(ctx, frame);
    const halos = recordedPaths(calls);
    expect(halos).toHaveLength(1);
    expect(halos[0]).toMatchObject({ kind: 'fill', style: 'accent' });
    expect(halos[0]?.arcs[0]?.x).toBe(0);
    expect(halos[0]?.arcs[0]?.r).toBeCloseTo((scene.radius[HUB] ?? 0) + 6);
  });
});
