import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphHistoryResponse } from '../../lib/api/graph-history-types';
import type { GraphResponse } from '../../lib/api/graph-types';
import { withQuery } from '../../lib/api/query-string';
import { isoAddDays, todayIso } from '../../lib/local-day';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { GraphScene } from './graph-scene';
import { GraphScreen } from './graph-screen';
import { GraphView } from './graph-view';
import { PLAY_STEP_MS } from './use-graph-time-travel';
import { installCanvasMock, VAULT, vaultGraph } from './__tests__/graph-test-helpers';

const NOW = Date.now();
const DAY = 86_400_000;
const GONE = '0 Inbox/Ghi chú đã xoá.md';

/** The small vault with filter facts: the hub was edited just now, the rest days ago. */
function graphWithFacts(): GraphResponse {
  const graph = vaultGraph();
  const facts: Record<string, Partial<GraphResponse['nodes'][number]>> = {
    [VAULT.hub]: { mtimeMs: NOW, tags: ['môn/giải-tích'] },
    [VAULT.project]: { mtimeMs: NOW - 3 * DAY, tags: ['dồ-án'] },
    [VAULT.daily]: { mtimeMs: NOW - 5 * DAY, tags: [] },
    [VAULT.other]: { mtimeMs: NOW - 40 * DAY, tags: ['dồ-án'] },
    [VAULT.orphan]: { mtimeMs: NOW - 90 * DAY, tags: [] },
  };
  return { ...graph, nodes: graph.nodes.map((node) => ({ ...node, ...facts[node.id] })) };
}

/** Monday of the current week and the two before. */
function mondays(): [string, string, string] {
  const today = todayIso();
  const [y, m, d] = today.split('-').map(Number);
  const weekday = (new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
  const current = isoAddDays(today, -weekday);
  return [isoAddDays(current, -14), isoAddDays(current, -7), current];
}

const midnight = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).getTime();
};

/** Week 1: hub, project (linked) and a note deleted in week 2; week 2: + daily; now: live. */
function history(): GraphHistoryResponse {
  const [w1, w2, w3] = mondays();
  const t1 = midnight(w1) + 3_600_000;
  const t2 = midnight(w2) + 3_600_000;
  return {
    firstWeek: w1,
    currentWeek: w3,
    exactSince: t1,
    nodes: [
      { id: VAULT.hub, kind: 'note', firstSeen: t1 },
      { id: VAULT.project, kind: 'note', firstSeen: t1 },
      {
        id: GONE,
        kind: 'note',
        firstSeen: t1,
        removedAt: t2,
        title: 'Ghi chú đã xoá',
        group: 'other',
        class: 'user',
      },
      { id: VAULT.daily, kind: 'note', firstSeen: t2 },
    ],
    edges: [
      { from: VAULT.project, to: VAULT.hub, addedAt: t1 },
      { from: GONE, to: VAULT.hub, addedAt: t1, removedAt: t2 },
      { from: VAULT.daily, to: VAULT.hub, addedAt: t2 },
    ],
  };
}

function renderScreen(query: Record<string, string> = {}) {
  const router = createMemoryRouter([{ path: '/graph', element: <GraphScreen /> }], {
    initialEntries: [withQuery('/graph', query)],
  });
  return render(<RouterProvider router={router} />);
}

const ready = () => screen.findByRole('slider', { name: 'Tuần đang xem' });
const filters = () => screen.getByRole('group', { name: 'Bộ lọc' });
const results = () => screen.queryByRole('listbox', { name: 'Ghi chú khớp' });
const listed = () =>
  within(screen.getByRole('listbox', { name: 'Ghi chú khớp' }))
    .getAllByRole('option')
    .map((option) => option.getAttribute('aria-label'));
const lastScene = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls[spy.mock.calls.length - 1]?.[0] as GraphScene;
const ids = (scene: GraphScene) => scene.model.nodes.map((node) => node.id).sort();

describe('brain map: filters, pulse and time scrubber (F24.1–F24.3)', () => {
  let mock: FetchMock;

  beforeEach(async () => {
    await resetAppState();
    installCanvasMock();
    mock = installFetchMock();
    mock.on('GET /api/graph', { body: graphWithFacts() });
    mock.on('GET /api/graph/history', { body: history() });
    mock.on('GET /api/tags', {
      body: {
        tags: [
          { tag: 'đồ-án', norm: 'dồ-án', count: 2 },
          { tag: 'môn/giải-tích', norm: 'môn/giải-tích', count: 1 },
        ],
      },
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('(F24.2) folder chips dim the rest on the canvas and the side panel lists only matches', async () => {
    const setFilter = vi.spyOn(GraphView.prototype, 'setFilter');
    const user = userEvent.setup();
    renderScreen();
    await ready();
    expect(setFilter).toHaveBeenLastCalledWith(null);
    await user.click(within(filters()).getByRole('button', { name: 'Daily' }));
    expect(within(filters()).getByRole('button', { name: 'Daily' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const mask = setFilter.mock.calls[setFilter.mock.calls.length - 1]?.[0] as Uint8Array;
    expect([...mask].reduce((a, b) => a + b, 0)).toBe(1);
    expect(listed()).toEqual(['2026-10-17, trong Daily']);
    expect(screen.getByText('1 ghi chú khớp bộ lọc')).toBeInTheDocument();
    await user.click(within(filters()).getByRole('button', { name: 'Areas' }));
    expect(listed()).toEqual([
      '2026-10-17, trong Daily',
      'Giải tích 1, trong 2 Areas, sửa trong 24 giờ',
      'Xác suất, trong 2 Areas',
    ]);
    await user.click(within(filters()).getByRole('button', { name: 'Bỏ lọc' }));
    expect(setFilter).toHaveBeenLastCalledWith(null);
    // Without a filter and a query the list is closed.
    expect(results()).toBeNull();
  });

  it('(F24.2) tag and time filters combine; search inside the matches', async () => {
    const user = userEvent.setup();
    renderScreen();
    await ready();
    await user.selectOptions(within(filters()).getByRole('combobox', { name: 'Thẻ' }), '#đồ-án');
    expect(listed()).toEqual(['Đồ án Giải tích, trong 1 Projects', 'Xác suất, trong 2 Areas']);
    await user.click(within(filters()).getByRole('button', { name: '7 ngày qua' }));
    expect(listed()).toEqual(['Đồ án Giải tích, trong 1 Projects']);
    await user.type(screen.getByRole('combobox', { name: 'Tìm ghi chú' }), 'xac suat');
    expect(
      screen.getByText('Không có ghi chú nào tên "xac suat" trong bộ lọc này.'),
    ).toBeInTheDocument();
  });

  it('(F24.2) remembered per vault', async () => {
    const user = userEvent.setup();
    const first = renderScreen();
    await ready();
    await user.click(within(filters()).getByRole('button', { name: 'Projects' }));
    expect(JSON.parse(localStorage.getItem('sb:vault-a:graph-filter') ?? 'null')).toEqual({
      groups: ['projects'],
      tag: null,
      time: 'all',
    });
    first.unmount();
    renderScreen();
    await ready();
    expect(within(filters()).getByRole('button', { name: 'Projects' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(listed()).toEqual(['Đồ án Giải tích, trong 1 Projects']);
  });

  it("(F24.2) #/graph?when=today opens on today's notes only, keeping what is remembered", async () => {
    localStorage.setItem(
      'sb:vault-a:graph-filter',
      JSON.stringify({ groups: ['daily'], tag: null, time: 'all' }),
    );
    renderScreen({ when: 'today' });
    await ready();
    expect(within(filters()).getByRole('button', { name: 'Hôm nay' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(filters()).getByRole('button', { name: 'Daily' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(listed()).toEqual(['Giải tích 1, trong 2 Areas, sửa trong 24 giờ']);
    expect(JSON.parse(localStorage.getItem('sb:vault-a:graph-filter') ?? 'null')).toMatchObject({
      groups: ['daily'],
    });
  });

  it('(F24.3) notes edited in the last 24 h pulse on the canvas and are marked in the panel', async () => {
    const setRecent = vi.spyOn(GraphView.prototype, 'setRecent');
    renderScreen({ focus: VAULT.hub });
    const details = await screen.findByRole('region', { name: 'Giải tích 1' });
    expect(within(details).getByText('sửa trong 24 giờ')).toBeInTheDocument();
    const indices = setRecent.mock.calls[setRecent.mock.calls.length - 1]?.[0] as Int32Array;
    expect(indices).toHaveLength(1);
    expect(screen.getByText('Chấm đập nhẹ là ghi chú sửa trong 24 giờ qua.')).toBeInTheDocument();
  });

  it('(F24.1) the scrubber shows the map at the end of each week; End is the live map again', async () => {
    const setScene = vi.spyOn(GraphView.prototype, 'setScene');
    renderScreen();
    const slider = await ready();
    const live = lastScene(setScene);
    expect(slider).toHaveAttribute('max', '2');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/bây giờ: 5 ghi chú, 4 liên kết$/),
    );
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(ids(lastScene(setScene))).toEqual([GONE, VAULT.hub, VAULT.project].sort());
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      expect.stringMatching(/: 3 ghi chú, 2 liên kết$/),
    );
    expect(setScene.mock.calls[setScene.mock.calls.length - 1]?.[1]).toMatchObject({
      intro: false,
      fit: false,
      fade: true,
    });
    // The side panel follows the week: the deleted note can be found there.
    await userEvent.setup().type(screen.getByRole('combobox', { name: 'Tìm ghi chú' }), 'da xoa');
    expect(listed()).toEqual(['Ghi chú đã xoá, trong 0 Inbox']);
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(ids(lastScene(setScene))).toEqual([VAULT.daily, VAULT.hub, VAULT.project].sort());
    fireEvent.keyDown(slider, { key: 'End' });
    expect(lastScene(setScene)).toBe(live);
  });

  it('(F24.1) "Phát" plays week by week up to now', async () => {
    renderScreen();
    const slider = await ready();
    vi.useFakeTimers();
    // One step per act: each step's timer starts once React has rendered the previous one.
    const step = () =>
      act(async () => {
        await vi.advanceTimersByTimeAsync(PLAY_STEP_MS);
      });
    fireEvent.click(screen.getByRole('button', { name: 'Phát' }));
    expect(slider).toHaveValue('0');
    expect(screen.getByRole('button', { name: 'Dừng' })).toBeInTheDocument();
    await step();
    expect(slider).toHaveValue('1');
    await step();
    expect(slider).toHaveValue('2');
    await step();
    expect(screen.getByRole('button', { name: 'Phát' })).toBeInTheDocument();
    expect(slider).toHaveValue('2');
  });

  it('(F24.1) reduced motion: no playing, the keys still step through the weeks', async () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderScreen();
    const slider = await ready();
    expect(screen.getByRole('button', { name: 'Phát' })).toBeDisabled();
    expect(screen.getByText('Chấm có vòng là ghi chú sửa trong 24 giờ qua.')).toBeInTheDocument();
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider).toHaveValue('1');
    // A past week has no "edited in the last 24 hours".
    expect(screen.queryByText('Chấm có vòng là ghi chú sửa trong 24 giờ qua.')).toBeNull();
  });
});
