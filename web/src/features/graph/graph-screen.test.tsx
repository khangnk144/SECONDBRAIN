import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withQuery } from '../../lib/api/query-string';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { GraphScreen } from './graph-screen';
import { GraphView } from './graph-view';
import { GRAPH_VIEW_KEYS } from './use-graph-view-keys';
import { GRAPH_REFRESH_MS } from './use-graph-data';
import { graphNode, installCanvasMock, VAULT, vaultGraph } from './__tests__/graph-test-helpers';

function renderScreen(query: Record<string, string> = {}) {
  const router = createMemoryRouter([{ path: '/graph', element: <GraphScreen /> }], {
    initialEntries: [withQuery('/graph', query)],
  });
  render(<RouterProvider router={router} />);
}

const ready = () => screen.findByRole('group', { name: 'Chú thích' });

describe('brain map screen', () => {
  let mock: FetchMock;

  beforeEach(async () => {
    await resetAppState();
    installCanvasMock();
    mock = installFetchMock();
    mock.on('GET /api/graph', { body: vaultGraph() });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('shows a loading state, then the map with its legend and view controls', async () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: 'Bản đồ não' })).toBeInTheDocument();
    expect(screen.getByText('Đang vẽ bản đồ não…')).toHaveAttribute('role', 'status');
    await ready();
    expect(screen.queryByText('Đang vẽ bản đồ não…')).toBeNull();
    const controls = screen.getByRole('group', { name: 'Điều khiển khung nhìn' });
    expect(within(controls).getAllByRole('button')).toHaveLength(3);
  });

  it('invites to write and link notes when the vault has nothing to draw', async () => {
    mock.on('GET /api/graph', { body: { nodes: [], edges: [] } });
    renderScreen();
    expect(
      await screen.findByText(
        'Chưa có ghi chú nào để vẽ. Viết vài ghi chú và nối chúng bằng [[ ]] nhé.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Chú thích' })).toBeNull();
  });

  it('explains a load error and retries', async () => {
    mock.on('GET /api/graph', apiError(500, 'INTERNAL'));
    const user = userEvent.setup();
    renderScreen();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không tải được bản đồ não');
    mock.on('GET /api/graph', { body: vaultGraph() });
    await user.click(within(alert).getByRole('button', { name: 'Thử lại' }));
    await ready();
  });

  it('?focus= selects that note and centers on it', async () => {
    const center = vi.spyOn(GraphView.prototype, 'centerOnNode');
    const select = vi.spyOn(GraphView.prototype, 'setSelection');
    renderScreen({ focus: VAULT.other });
    expect(await screen.findByRole('region', { name: 'Xác suất' })).toBeInTheDocument();
    expect(center).toHaveBeenCalledWith(VAULT.other);
    expect(select).toHaveBeenLastCalledWith(VAULT.other, 1);
  });

  it('refetches 500 ms after vault changes settle, keeping the map meanwhile', async () => {
    renderScreen();
    await ready();
    vi.useFakeTimers();
    const refreshed = vaultGraph();
    refreshed.nodes.push(graphNode('0 Inbox/Ý tưởng mới.md'));
    mock.on('GET /api/graph', { body: refreshed });
    act(() => {
      emitServerEvent({ type: 'note:created', path: '0 Inbox/Ý tưởng mới.md', revision: 'r1' });
      emitServerEvent({ type: 'note:changed', path: VAULT.hub, revision: 'r2' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRAPH_REFRESH_MS - 50);
    });
    expect(mock.callsTo('GET /api/graph')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(mock.callsTo('GET /api/graph')).toHaveLength(2);
    // Let the new layout run (it starts in a task after the response).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    vi.useRealTimers();
    const user = userEvent.setup();
    await user.type(screen.getByRole('combobox', { name: 'Tìm ghi chú' }), 'y tuong');
    expect(await screen.findByText('1 ghi chú khớp')).toBeInTheDocument();
    expect(screen.queryByText('Đang vẽ bản đồ não…')).toBeNull();
  });

  it('a document without a viewer yet gets a toast instead of opening', async () => {
    const user = userEvent.setup();
    renderScreen({ focus: VAULT.pdf });
    const details = await screen.findByRole('region', { name: 'Newton 1687.pdf' });
    expect(within(details).getByText('Tài liệu')).toBeInTheDocument();
    await user.click(within(details).getByRole('button', { name: 'Mở tài liệu' }));
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Xem tài liệu ngay trong app sẽ có ở bản sau.',
    ]);
  });

  it('0 resets the view and + / - zoom, but not while typing in the search box', async () => {
    const reset = vi.spyOn(GraphView.prototype, 'resetView');
    const zoom = vi.spyOn(GraphView.prototype, 'zoomBy');
    renderScreen();
    await ready();
    fireEvent.keyDown(document.body, { key: '0' });
    fireEvent.keyDown(document.body, { key: '+' });
    fireEvent.keyDown(document.body, { key: '-' });
    fireEvent.keyDown(document.body, { key: '0', ctrlKey: true });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(zoom.mock.calls.map(([factor]) => factor)).toEqual([1.25, 0.8]);
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Tìm ghi chú' }), { key: '0' });
    expect(reset).toHaveBeenCalledTimes(1);
    // The keys the shortcut sheet lists are exactly these.
    expect(GRAPH_VIEW_KEYS.map(({ keys }) => keys)).toEqual(['0', '+', '-', 'Esc']);
  });

  it('Esc clears the selection like "Bỏ chọn", but not from the search box or an open dialog (F16.4)', async () => {
    const select = vi.spyOn(GraphView.prototype, 'setSelection');
    renderScreen({ focus: VAULT.other });
    expect(await screen.findByRole('region', { name: 'Xác suất' })).toBeInTheDocument();
    const search = screen.getByRole('combobox', { name: 'Tìm ghi chú' });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Xác suất' })).toBeInTheDocument();

    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.append(dialog);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('region', { name: 'Xác suất' })).toBeInTheDocument();
    dialog.remove();

    const notPrevented = fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(notPrevented).toBe(false);
    expect(screen.queryByRole('region', { name: 'Xác suất' })).toBeNull();
    expect(select).toHaveBeenLastCalledWith(null, 1);
    // Nothing selected: Esc is left to others.
    expect(fireEvent.keyDown(document.body, { key: 'Escape' })).toBe(true);
  });

  it('clearing the selection from its details hands focus to the search box', async () => {
    const user = userEvent.setup();
    renderScreen({ focus: VAULT.other });
    const details = await screen.findByRole('region', { name: 'Xác suất' });
    act(() => within(details).getByRole('button', { name: 'Mở ghi chú' }).focus());
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Xác suất' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Tìm ghi chú' })).toHaveFocus();
  });

  it('follows the reduced-motion setting (F16.5)', async () => {
    const reduced = vi.spyOn(GraphView.prototype, 'setReducedMotion');
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    renderScreen();
    await ready();
    expect(reduced).toHaveBeenCalledWith(true);
    expect(reduced).not.toHaveBeenCalledWith(false);
  });
});
