import { act, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GRAPH_GROUPS } from '../../lib/api/graph-types';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { drawGraph } from './graph-draw';
import { GraphLegend } from './graph-legend';
import { SOURCE_RADIUS } from './graph-model';
import { GRAPH_GROUP_TOKENS, readGraphPalette, useGraphPalette } from './graph-palette';
import { createViewport } from './graph-viewport';
import {
  graphNode,
  graphResponse,
  readSourceFile,
  recordedPaths,
  recordingContext,
  staticScene,
} from './__tests__/graph-test-helpers';

/** SPEC §7 / design.md §10, dark theme with the default palette. */
const DARK = {
  projects: '#d88ab6',
  areas: '#b9a0d6',
  resources: '#5fb89e',
  wiki: '#f2b255',
  daily: '#8a7e90',
  other: '#4a3e52',
};

let graphCss = '';
beforeAll(async () => {
  const style = document.createElement('style');
  style.textContent = await readSourceFile('../../../styles/tokens.css');
  document.head.append(style);
  graphCss = await readSourceFile('../graph.css');
});
beforeEach(async () => {
  await resetAppState();
});
afterEach(() => {
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.palette;
});

describe('graph colors follow the design tokens (F16.2)', () => {
  it('maps every group to its --graph-* token, read from the computed style', () => {
    const palette = readGraphPalette();
    GRAPH_GROUPS.forEach((group, i) => {
      expect(GRAPH_GROUP_TOKENS[group]).toBe(`--graph-${group}`);
      expect(palette.groups[i]).toBe(DARK[group]);
    });
    expect(palette.background).toBe('#1c1622');
    expect(palette.edge).toBe('#a595ac');
  });

  it('reads the colors again when the theme or the palette changes', async () => {
    const { result } = renderHook(() => useGraphPalette());
    expect(result.current.groups[0]).toBe(DARK.projects);
    await act(async () => {
      document.documentElement.dataset.theme = 'light';
      await Promise.resolve();
    });
    expect(result.current.groups[0]).toBe('#9e3f73');
    expect(result.current.groups[5]).toBe('#d8cfda');
    await act(async () => {
      delete document.documentElement.dataset.theme;
      document.documentElement.dataset.palette = 'hoa-dao';
      await Promise.resolve();
    });
    expect(result.current.groups[0]).toBe('#e58aa3');
  });

  it('legend: one dot per group present, each styled by its token, plus documents and orphans', () => {
    render(<GraphLegend groups={GRAPH_GROUPS} hasSources hasOrphans />);
    const legend = screen.getByRole('group', { name: 'Chú thích' });
    const labels = ['Projects', 'Areas', 'Resources', 'Wiki', 'Daily', 'Khác', 'Tài liệu'];
    expect(
      within(legend)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(labels);
    for (const group of GRAPH_GROUPS) {
      const dot = legend.querySelector(`[data-group="${group}"] .graph-legend__dot`);
      expect(dot).toHaveClass(`graph-legend__dot--${group}`);
      const rule = new RegExp(
        `\\.graph-legend__dot--${group}\\s*\\{\\s*background:\\s*var\\(--graph-${group}\\);`,
      );
      expect(graphCss).toMatch(rule);
    }
    expect(graphCss).toMatch(/\.graph-legend__dot--source\s*\{[^}]*background:\s*transparent/);
    expect(within(legend).getByText(/mồ côi/)).toBeInTheDocument();
  });

  it('legend lists only the groups present', () => {
    render(<GraphLegend groups={['areas', 'daily']} hasSources={false} hasOrphans={false} />);
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Areas', 'Daily']);
  });

  it('canvas: dots filled with their group color, orphans at 50 %, sources hollow, edges 25 %', () => {
    const notes = GRAPH_GROUPS.map((group) => graphNode(`${group}/Ghi chú ${group}.md`, { group }));
    const lonely = graphNode('0 Inbox/Mồ côi.md', { group: 'projects' });
    const pdf = graphNode('3 Resources/papers/Newton.pdf', { kind: 'source', group: 'resources' });
    const edges = notes.slice(1).map((n): [string, string] => [notes[0]?.id ?? '', n.id]);
    const scene = staticScene(
      graphResponse([...notes, lonely, pdf], [...edges, [notes[2]?.id ?? '', pdf.id]]),
    );
    const { ctx, calls } = recordingContext();
    const palette = readGraphPalette();
    drawGraph(
      ctx,
      scene.frameInput(palette, createViewport(), { width: 800, height: 600, dpr: 1 }),
    );
    const paths = recordedPaths(calls);
    const coreFillOf = (index: number) =>
      paths.find(
        (p) =>
          p.kind === 'fill' &&
          p.arcs.some((a) => a.x === scene.px[index] && a.r === scene.radius[index]),
      );

    GRAPH_GROUPS.forEach((group, i) => {
      const path = coreFillOf(scene.model.indexById.get(notes[i]?.id ?? '') ?? -1);
      expect(path?.style).toBe(DARK[group]);
      expect(path?.alpha).toBe(1);
    });
    const orphan = coreFillOf(scene.model.indexById.get(lonely.id) ?? -1);
    expect(orphan?.style).toBe(DARK.projects);
    expect(orphan?.alpha).toBe(0.5);

    const source = scene.model.indexById.get(pdf.id) ?? -1;
    const touchesSource = paths.filter((p) => p.arcs.some((a) => a.x === scene.px[source]));
    expect(touchesSource).toHaveLength(1);
    expect(touchesSource[0]).toMatchObject({ kind: 'stroke', style: DARK.resources });
    expect(touchesSource[0]?.arcs[0]?.r).toBe(SOURCE_RADIUS);

    const edgesPath = paths.find((p) => p.kind === 'stroke' && p.lines > 0);
    expect(edgesPath).toMatchObject({ style: '#a595ac', alpha: 0.25, lines: 6 });
  });
});
