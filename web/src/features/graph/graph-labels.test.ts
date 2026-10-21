import { describe, expect, it } from 'vitest';
import { drawGraph, GLOW_ALPHA, GLOW_EXTRA_PX, type LabelRect } from './graph-draw';
import {
  AMBIENT_LABELS_AT_FIT,
  ambientLabelBudget,
  LABEL_EDGE_PX,
  LABEL_HEIGHT_PX,
  MAX_AMBIENT_LABELS,
} from './graph-labels';
import type { GraphPalette } from './graph-palette';
import type { GraphScene } from './graph-scene';
import { GraphView } from './graph-view';
import { boundsOf, createViewport, fitViewport, zoomAt } from './graph-viewport';
import {
  generatedGraph,
  graphNode,
  graphResponse,
  LABEL_CHAR_PX,
  manualScheduler,
  recordedPaths,
  recordingContext,
  staticScene,
  vaultGraph,
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
const W = 1200;
const H = 800;

interface DrawnLabel {
  text: string;
  x: number;
  y: number;
  width: number;
  quiet: boolean;
}

/** Draws one frame of `scene` (fitted to W × H, then `zoom`) and returns the names drawn. */
function drawLabels(
  scene: GraphScene,
  options: { zoom?: number; ambient?: boolean; exclusions?: LabelRect[] } = {},
) {
  const { ctx, calls } = recordingContext();
  const view = createViewport();
  fitViewport(view, boundsOf(scene.model.nodes), W, H);
  if (options.zoom) zoomAt(view, options.zoom, W / 2, H / 2);
  const frame = scene.frameInput(PALETTE, view, { width: W, height: H, dpr: 1 });
  frame.ambientLabels = options.ambient ?? true;
  frame.labelExclusions = options.exclusions ?? [];
  frame.ring = scene.selection?.index ?? -1;
  frame.hover = scene.hover;
  frame.levels = scene.levels;
  drawGraph(ctx, frame);
  const labels: DrawnLabel[] = calls
    .filter((call) => call.method === 'fillText')
    .map((call) => {
      const [text, x, y] = call.args as [string, number, number];
      const width = Array.from(text).length * LABEL_CHAR_PX;
      return { text, x, y, width, quiet: call.fillStyle === PALETTE.quietInk };
    });
  return { labels, view, paths: recordedPaths(calls) };
}

function expectNoOverlap(labels: DrawnLabel[]) {
  for (const [k, a] of labels.entries()) {
    for (const b of labels.slice(k + 1)) {
      const apartX = a.x + a.width <= b.x || b.x + b.width <= a.x;
      const apartY = Math.abs(a.y - b.y) >= LABEL_HEIGHT_PX;
      expect(apartX || apartY, `${a.text} / ${b.text}`).toBe(true);
    }
  }
}

/** A big vault: 600 notes on a wide grid, so the fitted view shows dots of about 1 px. */
function bigVault() {
  return staticScene(generatedGraph(600, 900), (i) => ({
    x: (i % 30) * 200,
    y: Math.floor(i / 30) * 200,
  }));
}

describe('brain map names: hubs first, more when zoomed in', () => {
  it('the budget of quiet names grows with the zoomed area', () => {
    expect(ambientLabelBudget(0.2, 0.2)).toBe(AMBIENT_LABELS_AT_FIT);
    expect(ambientLabelBudget(0.1, 0.2)).toBe(Math.round(AMBIENT_LABELS_AT_FIT / 4));
    expect(ambientLabelBudget(0.4, 0.2)).toBe(MAX_AMBIENT_LABELS);
  });

  it('a big vault at the fitted zoom names only its top hubs, in --ink-2, never overlapping', () => {
    const scene = bigVault();
    const { labels } = drawLabels(scene);
    expect(labels.length).toBeGreaterThan(5);
    expect(labels.length).toBeLessThanOrEqual(AMBIENT_LABELS_AT_FIT);
    expect(labels.every((label) => label.quiet)).toBe(true);
    const degrees = scene.model.nodes.map((node) => node.degree).sort((a, b) => b - a);
    const cutoff = degrees[2 * AMBIENT_LABELS_AT_FIT] ?? 0;
    for (const label of labels) {
      const node = scene.model.nodes.find((candidate) => candidate.title === label.text);
      expect(node?.degree, label.text).toBeGreaterThanOrEqual(cutoff);
    }
    expectNoOverlap(labels);
  });

  it('zooming in shows more names, still apart and inside the canvas', () => {
    const scene = bigVault();
    const atFit = drawLabels(scene).labels.length;
    const zoomed = drawLabels(scene, { zoom: 2.5 }).labels;
    expect(zoomed.length).toBeGreaterThan(atFit * 2);
    expect(zoomed.length).toBeLessThanOrEqual(MAX_AMBIENT_LABELS);
    expectNoOverlap(zoomed);
    for (const label of zoomed) {
      expect(label.x).toBeGreaterThanOrEqual(LABEL_EDGE_PX);
      expect(label.x + label.width).toBeLessThanOrEqual(W - LABEL_EDGE_PX);
    }
  });

  it('a small vault shows most of its names at the fitted zoom', () => {
    const scene = staticScene(vaultGraph(), (i) => ({ x: (i % 2) * 120, y: i * 30 }));
    const { labels } = drawLabels(scene);
    expect(labels.length).toBeGreaterThanOrEqual(scene.model.nodes.length - 1);
    expectNoOverlap(labels);
  });

  /**
   * A note between two dots 20 world units away on each side; with `hubs`, five better linked
   * notes (a clique) far away take the turns of the biggest hubs.
   */
  function crowdedScene(hubs: boolean) {
    const [mid, left, right] = ['2 Areas/Giải tích 1.md', 'Daily/Trái.md', 'Daily/Phải.md'];
    const clique = hubs ? [1, 2, 3, 4, 5].map((n) => `wiki/Khái niệm ${n}.md`) : [];
    const edges: [string, string][] = [
      [mid, left],
      [mid, right],
    ];
    clique.forEach((a, k) => clique.slice(k + 1).forEach((b) => edges.push([a, b])));
    return staticScene(
      graphResponse(
        [mid, left, right, ...clique].map((id) => graphNode(id)),
        edges,
      ),
      (i) => (i < 3 ? { x: [0, -20, 20][i] ?? 0, y: 0 } : { x: 300 + (i - 3) * 120, y: 300 }),
    );
  }

  it('the biggest hubs keep their names in a crowded spot; other quiet names keep off dots', () => {
    const names = (scene: GraphScene, options = {}) =>
      drawLabels(scene, options).labels.map((l) => l.text);
    // Alone, the best linked note is a hub: its name may cross the dot beside it.
    expect(names(crowdedScene(false))).toContain('Giải tích 1');
    // Behind five better linked notes it is a quiet name: no clean spot, so no name.
    const scene = crowdedScene(true);
    expect(names(scene)).toContain('Khái niệm 1');
    expect(names(scene)).toEqual(expect.arrayContaining(['Phải', 'Trái']));
    expect(names(scene)).not.toContain('Giải tích 1');
    // Hovered, it is always named.
    scene.setHover(0);
    expect(names(scene)).toContain('Giải tích 1');
    scene.setHover(-1);
    // An overlay over the right-hand dot's name (e.g. the legend) hides that quiet name.
    const view = drawLabels(scene).view;
    const rightX = 20 * view.scale + view.tx;
    const overlay = { x: rightX, y: view.ty - 20, width: 200, height: 40 };
    expect(names(scene, { exclusions: [overlay] })).not.toContain('Phải');
    expect(names(scene, { exclusions: [overlay] })).toContain('Trái');
  });

  it('with a selection only the lit names show; hover and selection always win', () => {
    // Three notes so close that their names must collide.
    const ids = ['A', 'B', 'C'].map((name) => `2 Areas/Một tên khá dài ${name}.md`);
    const scene = staticScene(
      graphResponse(
        ids.map((id) => graphNode(id)),
        [
          [ids[0] ?? '', ids[1] ?? ''],
          [ids[1] ?? '', ids[2] ?? ''],
        ],
      ),
      (i) => ({ x: i * 4, y: 0 }),
    );
    scene.select(1, 1, false);
    scene.setHover(2);
    const { labels } = drawLabels(scene);
    expect(labels.some((label) => label.quiet)).toBe(false);
    const names = labels.map((label) => label.text);
    expect(names).toContain('Một tên khá dài B');
    expect(names).toContain('Một tên khá dài C');
    // The lit neighbour A would overlap them, so it is skipped.
    expect(names).not.toContain('Một tên khá dài A');
    expect(drawLabels(scene, { ambient: true }).labels.every((label) => !label.quiet)).toBe(true);
  });

  it('a name that would leave the canvas goes left of its dot', () => {
    const ids = ['2 Areas/Giải tích 1.md', '1 Projects/Một ghi chú có cái tên khá dài.md'];
    const scene = staticScene(
      graphResponse(
        ids.map((id) => graphNode(id)),
        [[ids[0] ?? '', ids[1] ?? '']],
      ),
      (i) => ({ x: i * 500, y: 0 }),
    );
    scene.setHover(1);
    const { labels, view } = drawLabels(scene, { ambient: false });
    const dotX = (scene.px[1] ?? 0) * view.scale + view.tx;
    expect(labels.map((label) => label.text)).toEqual(['Một ghi chú có cái tên khá dài']);
    expect((labels[0]?.x ?? 0) + (labels[0]?.width ?? 0)).toBeLessThan(dotX);
    expect(labels[0]?.x).toBeGreaterThanOrEqual(LABEL_EDGE_PX);
  });

  it('the glow is one small layer: the dot radius plus 4 px, at low opacity', () => {
    const scene = staticScene(vaultGraph());
    const { paths, view } = drawLabels(scene, { ambient: false });
    const hub = scene.model.indexById.get('2 Areas/Giải tích 1.md') ?? -1;
    const glow = paths.find(
      (p) =>
        p.kind === 'fill' &&
        p.arcs.some((a) => a.x === scene.px[hub] && a.r > (scene.radius[hub] ?? 0)),
    );
    expect(glow?.arcs.find((a) => a.x === scene.px[hub])?.r).toBeCloseTo(
      (scene.radius[hub] ?? 0) + GLOW_EXTRA_PX / view.scale,
    );
    expect(glow?.alpha).toBeLessThanOrEqual(GLOW_ALPHA);
  });
});

describe('local graph: the note keeps its whole name in view', () => {
  /** Draws a local graph whose own note (`title`) sits right of its one neighbour. */
  function localNames(title: string) {
    const own = `1 Projects/${title}.md`;
    const other = '2 Areas/Giải tích 1.md';
    const scene = staticScene(
      graphResponse([graphNode(own), graphNode(other)], [[own, other]]),
      (i) => ({
        x: i === 0 ? 60 : 0,
        y: 0,
      }),
    );
    scene.pinnedLabel = 0;
    scene.refreshHighlight();
    const { ctx, calls } = recordingContext();
    const canvas = { getContext: () => ctx, width: 0, height: 0 } as unknown as HTMLCanvasElement;
    const scheduler = manualScheduler();
    const view = new GraphView(canvas, {
      mode: 'local',
      palette: PALETTE,
      reducedMotion: true,
      scheduler,
    });
    view.setSize(248, 200, 1);
    view.setScene(scene, { intro: false, fit: true });
    scheduler.flush(0);
    return calls
      .filter((call) => call.method === 'fillText')
      .map((call) => {
        const [text, x] = call.args as [string, number];
        return { text, x, end: x + Array.from(text).length * LABEL_CHAR_PX };
      });
  }

  it('fits the view so the pinned name ends inside the canvas', () => {
    const [own, ...rest] = localNames('Research – Tìm research gap');
    expect(rest).toEqual([]);
    expect(own?.text).toBe('Research – Tìm research gap');
    expect(own?.x).toBeGreaterThanOrEqual(LABEL_EDGE_PX);
    expect(own?.end).toBeLessThanOrEqual(248 - LABEL_EDGE_PX);
  });

  it('a name wider than the canvas is shortened with "…", still inside', () => {
    const [own] = localNames('Research – Tìm research gap cho đồ án tốt nghiệp');
    expect(own?.text.endsWith('…')).toBe(true);
    expect(own?.x).toBeGreaterThanOrEqual(LABEL_EDGE_PX);
    expect(own?.end).toBeLessThanOrEqual(248 - LABEL_EDGE_PX);
  });
});
