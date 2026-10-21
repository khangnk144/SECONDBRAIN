import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { noteRoute } from '../../lib/app-navigation';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import {
  AI_TOUCH_HOLD_MS,
  litAiTouchPaths,
  resetAiTouchStore,
  startAiTouchSync,
  useAiTouchStore,
} from './graph-ai-touch';
import { GraphScreen } from './graph-screen';
import { GraphView } from './graph-view';
import { graphNode, graphResponse, installCanvasMock, VAULT } from './__tests__/graph-test-helpers';

const SOURCE = '3 Resources/papers/Attention.pdf';
const PAPER = 'wiki/papers/Attention is all you need.md';
const CONCEPT = 'wiki/concepts/Self-attention.md';
const GAP = 'wiki/research-gaps/đồ án giải tích.md';
const OUTPUTS = [PAPER, CONCEPT, GAP];

/** The vault before the ingest, then with the pages it wrote (`missing` left out). */
function vaultBefore() {
  return graphResponse(
    [graphNode(VAULT.hub), graphNode(VAULT.project), graphNode(VAULT.other)],
    [
      [VAULT.project, VAULT.hub],
      [VAULT.project, VAULT.other],
    ],
  );
}

function vaultAfter(missing: string[] = []) {
  const ids = [VAULT.hub, VAULT.project, VAULT.other, PAPER, CONCEPT, GAP];
  const nodes = ids.filter((id) => !missing.includes(id)).map((id) => graphNode(id));
  nodes.push(graphNode(SOURCE, { kind: 'source', class: 'source' }));
  const edges: [string, string][] = [
    [VAULT.project, VAULT.hub],
    [VAULT.project, VAULT.other],
    [PAPER, SOURCE],
    [PAPER, CONCEPT],
    [GAP, PAPER],
    [GAP, VAULT.project],
  ];
  const present = new Set(nodes.map((node) => node.id));
  return graphResponse(
    nodes,
    edges.filter(([a, b]) => present.has(a) && present.has(b)),
  );
}

function renderScreen() {
  const router = createMemoryRouter([{ path: '/graph', element: <GraphScreen /> }], {
    initialEntries: ['/graph'],
  });
  render(<RouterProvider router={router} />);
}

const ready = () => screen.findByRole('group', { name: 'Chú thích' });
const event = () => useAiTouchStore.getState().events[0];
const lit = () => litAiTouchPaths(useAiTouchStore.getState().events, Date.now());
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const touch = () =>
  act(() => emitServerEvent({ type: 'ai:touched', source: SOURCE, outputs: OUTPUTS }));

function reduceMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener() {}, removeEventListener() {} })),
  );
}

describe('graph "AI vừa chạm" (F34.1)', () => {
  let mock: FetchMock;
  let navigate: Mock<Navigator>;
  let stopSync: () => void;

  beforeEach(async () => {
    navigate = (await resetAppState()) as Mock<Navigator>;
    resetAiTouchStore();
    stopSync = startAiTouchSync();
    installCanvasMock();
    mock = installFetchMock();
    mock.on('GET /api/graph', { body: vaultBefore() });
  });
  afterEach(() => {
    stopSync();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refetches once for the new pages, then lights them in order 150 ms apart, each for 10 s', async () => {
    const handOver = vi.spyOn(GraphView.prototype, 'setAiTouches');
    renderScreen();
    await ready();
    vi.useFakeTimers();
    mock.on('GET /api/graph', { body: vaultAfter() });
    touch();
    await advance(1);
    await advance(1);
    expect(mock.callsTo('GET /api/graph')).toHaveLength(2);
    const playback = event()?.playback;
    expect(playback).not.toBeNull();
    const { startedAt, sequence, endsAt } = playback!;
    expect(sequence.map((step) => step.path)).toEqual(OUTPUTS);
    // The source appears (600 ms), then signals leave 150 ms apart and arrive 300 ms later.
    expect(sequence.map((step) => step.at - startedAt)).toEqual([900, 1050, 1200]);
    expect(endsAt - startedAt).toBe(1200 + AI_TOUCH_HOLD_MS);
    // The canvas got the playback, source included.
    expect(handOver).toHaveBeenLastCalledWith(
      [expect.objectContaining({ source: SOURCE, sourceTitle: 'Attention.pdf', playback })],
      expect.any(Number),
    );

    await advance(startedAt + 899 - Date.now());
    expect(lit()).toEqual([]);
    await advance(1);
    expect(lit()).toEqual([PAPER]);
    await advance(150);
    expect(lit()).toEqual([PAPER, CONCEPT]);
    await advance(150);
    expect(lit()).toEqual(OUTPUTS);
    await advance(AI_TOUCH_HOLD_MS - 300);
    expect(lit()).toEqual([CONCEPT, GAP]);
    await advance(300);
    expect(lit()).toEqual([]);
    // Over: the highlights leave the canvas; no further refetch happened.
    expect(handOver).toHaveBeenLastCalledWith([], expect.any(Number));
    expect(mock.callsTo('GET /api/graph')).toHaveLength(2);
  });

  it('lists the source and the pages in order in the side panel and announces it once', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/graph', { body: vaultAfter() });
    renderScreen();
    await ready();
    touch();
    const panel = await screen.findByRole('region', { name: 'AI vừa cập nhật' });
    const list = within(panel).getByRole('list', {
      name: 'Các trang AI vừa cập nhật từ Attention.pdf',
    });
    expect(
      within(list)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Attention is all you need', 'Self-attention', 'đồ án giải tích']);
    expect(screen.getByText('AI vừa cập nhật 3 trang từ Attention.pdf.')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    // Everything was on the map: no refetch.
    expect(mock.callsTo('GET /api/graph')).toHaveLength(1);

    // Keyboard: from the search box, Tab reaches the source, then the pages, then "Ẩn danh sách".
    await user.click(screen.getByRole('combobox', { name: 'Tìm ghi chú' }));
    await user.tab();
    expect(within(panel).getByRole('button', { name: 'Attention.pdf' })).toHaveFocus();
    await user.tab();
    expect(within(list).getByRole('button', { name: 'Attention is all you need' })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenLastCalledWith(noteRoute(CONCEPT), undefined);
  });

  it('plays what the map has when pages are still missing after the one refetch', async () => {
    renderScreen();
    await ready();
    vi.useFakeTimers();
    mock.on('GET /api/graph', { body: vaultAfter([GAP]) });
    touch();
    await advance(1);
    await advance(1);
    const playback = event()?.playback;
    expect(playback?.sequence.map((step) => step.path)).toEqual([PAPER, CONCEPT]);
    expect(mock.callsTo('GET /api/graph')).toHaveLength(2);
    vi.useRealTimers();
    const panel = screen.getByRole('region', { name: 'AI vừa cập nhật' });
    expect(within(panel).getAllByRole('listitem')).toHaveLength(3);
  });

  it('under reduced motion lights every page at once, for 10 s, without travel', async () => {
    reduceMotion();
    mock.on('GET /api/graph', { body: vaultAfter() });
    renderScreen();
    await ready();
    vi.useFakeTimers();
    touch();
    await advance(0);
    const playback = event()?.playback;
    expect(playback?.reducedMotion).toBe(true);
    expect(playback?.sequence.every((step) => step.at === playback.startedAt)).toBe(true);
    expect(lit()).toEqual(OUTPUTS);
    await advance(AI_TOUCH_HOLD_MS - 1);
    expect(lit()).toEqual(OUTPUTS);
    await advance(1);
    expect(lit()).toEqual([]);
  });

  it('keeps an event that came while the map was closed and counts the 10 s from when it shows', async () => {
    vi.useFakeTimers();
    const received = Date.now();
    touch();
    await advance(30_000);
    mock.on('GET /api/graph', { body: vaultAfter() });
    renderScreen();
    await advance(1);
    await advance(1);
    const playback = event()?.playback;
    expect(event()?.receivedAt).toBe(received);
    expect(playback?.startedAt).toBeGreaterThanOrEqual(received + 30_000);
    expect(playback && playback.endsAt - playback.startedAt).toBe(1200 + AI_TOUCH_HOLD_MS);
  });

  it('"Ẩn danh sách" forgets the list and puts the keyboard back on the search box', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/graph', { body: vaultAfter() });
    renderScreen();
    await ready();
    touch();
    const panel = await screen.findByRole('region', { name: 'AI vừa cập nhật' });
    await user.click(within(panel).getByRole('button', { name: 'Ẩn danh sách' }));
    expect(screen.queryByRole('region', { name: 'AI vừa cập nhật' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Tìm ghi chú' })).toHaveFocus();
    expect(useAiTouchStore.getState().events).toEqual([]);
  });
});
