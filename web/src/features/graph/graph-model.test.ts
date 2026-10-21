import { describe, expect, it } from 'vitest';
import {
  ARCHIVED_ALPHA,
  buildGraphModel,
  indexOfPath,
  neighborLevels,
  nodeRadius,
  nodesAtLevel,
  ORPHAN_ALPHA,
  SOURCE_RADIUS,
  UNREACHED,
} from './graph-model';
import { graphNode, graphResponse } from './__tests__/graph-test-helpers';

const A = '2 Areas/Giải tích 1.md';
const B = '1 Projects/Đồ án Giải tích.md';
const C = 'Daily/2026-10-17.md';
const D = 'wiki/Xác suất.md';
const PDF = '3 Resources/papers/Newton 1687.pdf';

describe('graph model: look of each node (F16.2)', () => {
  it('sizes nodes as 4 px + log(1 + links); a lone note is exactly 4 px', () => {
    expect(nodeRadius(0)).toBe(4);
    expect(nodeRadius(10)).toBeCloseTo(4 + Math.log(11));
    expect(nodeRadius(100)).toBeGreaterThan(nodeRadius(10));
  });

  it('dims orphans to 50 %, archived notes further, and draws sources small and hollow', () => {
    const model = buildGraphModel(
      graphResponse(
        [
          graphNode(A),
          graphNode(B),
          graphNode('0 Inbox/Mồ côi.md'),
          graphNode('4 Archive/Cũ.md', { class: 'archived' }),
          graphNode(PDF, { kind: 'source', class: 'attachment' }),
        ],
        [
          [A, B],
          [A, PDF],
        ],
      ),
    );
    const byTitle = (title: string) => model.nodes.find((n) => n.title === title);
    expect(byTitle('Giải tích 1')?.baseAlpha).toBe(1);
    expect(byTitle('Mồ côi')?.baseAlpha).toBe(ORPHAN_ALPHA);
    expect(ORPHAN_ALPHA).toBe(0.5);
    // An archived note without links is both: dimmed and an orphan.
    expect(byTitle('Cũ')?.baseAlpha).toBeCloseTo(ARCHIVED_ALPHA * ORPHAN_ALPHA);
    const pdf = model.nodes[model.indexById.get(PDF) ?? -1];
    expect(pdf?.source).toBe(true);
    expect(pdf?.radius).toBe(SOURCE_RADIUS);
    expect(model.hasSources).toBe(true);
    expect(model.hasOrphans).toBe(true);
  });

  it('lists the groups present in legend order; an unknown group counts as other', () => {
    const model = buildGraphModel(
      graphResponse(
        [graphNode(C), graphNode(A), graphNode('x.md', { group: 'nonsense' as never })],
        [],
      ),
    );
    expect(model.groups).toEqual(['areas', 'daily', 'other']);
  });
});

describe('graph model: defensive edges', () => {
  it('drops self-links, repeated pairs in either direction and unknown ids', () => {
    const model = buildGraphModel({
      nodes: [graphNode(A), graphNode(B), graphNode(C), graphNode(A, { title: 'again' })],
      edges: [
        { source: A, target: B },
        { source: B, target: A },
        { source: A, target: B },
        { source: A, target: A },
        { source: A, target: 'gone.md' },
        { source: 'ghost.md', target: C },
        { source: B, target: C },
      ],
    });
    expect(model.nodes.map((n) => n.title)).toEqual([
      'Giải tích 1',
      'Đồ án Giải tích',
      '2026-10-17',
    ]);
    expect(model.edgeSource.length).toBe(2);
    expect(model.neighbors[0]).toEqual([1]);
    expect([...(model.neighbors[1] ?? [])].sort()).toEqual([0, 2]);
  });
});

describe('graph model: neighbourhoods', () => {
  // A – B – C – D, and A – PDF.
  const model = buildGraphModel(
    graphResponse(
      [graphNode(A), graphNode(B), graphNode(C), graphNode(D), graphNode(PDF, { kind: 'source' })],
      [
        [A, B],
        [B, C],
        [C, D],
        [PDF, A],
      ],
    ),
  );

  it('depth 1 reaches exactly the direct neighbours, both link directions', () => {
    const levels = neighborLevels(model, model.indexById.get(A) ?? -1, 1);
    expect(
      nodesAtLevel(model, levels, 1)
        .map((n) => n.id)
        .sort(),
    ).toEqual([B, PDF].sort());
    expect(levels[model.indexById.get(C) ?? -1]).toBe(UNREACHED);
  });

  it('depth 2 adds the next ring and reuses the output array', () => {
    const out = new Int8Array(model.nodes.length);
    const levels = neighborLevels(model, model.indexById.get(A) ?? -1, 2, out);
    expect(levels).toBe(out);
    expect(nodesAtLevel(model, levels, 2).map((n) => n.id)).toEqual([C]);
    expect(levels[model.indexById.get(D) ?? -1]).toBe(UNREACHED);
  });

  it('finds a path whatever its case or Unicode normalization', () => {
    expect(indexOfPath(model, A.normalize('NFD').toUpperCase())).toBe(model.indexById.get(A));
    expect(indexOfPath(model, 'missing.md')).toBe(-1);
  });
});
