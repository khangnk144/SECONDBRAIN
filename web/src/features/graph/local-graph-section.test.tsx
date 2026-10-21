import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphResponse } from '../../lib/api/graph-types';
import type { Navigator } from '../../lib/app-navigation';
import { noteRoute } from '../../lib/app-navigation';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { graphRoute } from './graph-selection';
import { LocalGraphSection } from './local-graph-section';
import { installCanvasMock, VAULT, vaultGraph } from './__tests__/graph-test-helpers';

/** The vault graph restricted to `depth` hops around the hub, as `GET /graph/local` answers. */
function localGraph(depth: 1 | 2): GraphResponse {
  const full = vaultGraph();
  const keep = new Set<string>([VAULT.hub, VAULT.project, VAULT.daily, VAULT.pdf]);
  if (depth === 2) keep.add(VAULT.other);
  return {
    nodes: full.nodes.filter((n) => keep.has(n.id)),
    edges: full.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
  };
}

describe('local graph in the note panel (F16.6)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;

  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    installCanvasMock();
    mock = installFetchMock();
    mock.on('GET /api/graph/local', (call) => ({
      body: localGraph(call.query.get('depth') === '2' ? 2 : 1),
    }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('lists exactly the depth-1 neighbours of the note, next to a static canvas', async () => {
    // Even if the server sent a farther node, depth 1 lists only direct neighbours.
    mock.on('GET /api/graph/local', { body: localGraph(2) });
    render(<LocalGraphSection path={VAULT.hub} />);
    const list = await screen.findByRole('list', { name: 'Ghi chú kề của Giải tích 1' });
    const names = within(list)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names.sort()).toEqual(['2026-10-17', 'Newton 1687.pdf', 'Đồ án Giải tích'].sort());
    expect(screen.queryByText('Xác suất')).toBeNull();
    const call = mock.callsTo('GET /api/graph/local')[0];
    expect(call?.query.get('path')).toBe(VAULT.hub);
    expect(call?.query.get('depth')).toBe('1');
    expect(document.querySelector('canvas.local-graph__canvas')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('shows the second level on request', async () => {
    const user = userEvent.setup();
    render(<LocalGraphSection path={VAULT.hub} />);
    await screen.findByRole('list', { name: 'Ghi chú kề của Giải tích 1' });
    await user.click(screen.getByRole('checkbox', { name: 'Hiện thêm cấp 2' }));
    const second = await screen.findByRole('list', { name: 'Ghi chú ở cấp 2' });
    expect(
      within(second)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Xác suất']);
    expect(mock.callsTo('GET /api/graph/local').at(-1)?.query.get('depth')).toBe('2');
  });

  it('opens a neighbour, toasts for a document and opens the full map on this note', async () => {
    const user = userEvent.setup();
    render(<LocalGraphSection path={VAULT.hub} />);
    const list = await screen.findByRole('list', { name: 'Ghi chú kề của Giải tích 1' });
    await user.click(within(list).getByRole('button', { name: 'Đồ án Giải tích' }));
    expect(navigate).toHaveBeenLastCalledWith(noteRoute(VAULT.project), undefined);
    await user.click(within(list).getByRole('button', { name: 'Newton 1687.pdf' }));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Mở bản đồ não' }));
    expect(navigate).toHaveBeenLastCalledWith(graphRoute(VAULT.hub), undefined);
    expect(graphRoute(VAULT.hub)).toBe(`/graph?focus=${encodeURIComponent(VAULT.hub)}`);
  });

  it('a note that exists but is not drawn (template) gets an empty graph: not on the map', async () => {
    mock.on('GET /api/graph/local', { body: { nodes: [], edges: [] } });
    render(<LocalGraphSection path="Templates/Đồ án.md" />);
    expect(await screen.findByText('Ghi chú này không có trên bản đồ não.')).toBeInTheDocument();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('says when the note is not on the map, and fetches nothing while collapsed', async () => {
    mock.on('GET /api/graph/local', apiError(404, 'NOT_FOUND'));
    const user = userEvent.setup();
    render(<LocalGraphSection path="Templates/Daily.md" />);
    expect(await screen.findByText('Ghi chú này không có trên bản đồ não.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bản đồ cục bộ' }));
    expect(screen.queryByText('Ghi chú này không có trên bản đồ não.')).toBeNull();
    expect(mock.callsTo('GET /api/graph/local')).toHaveLength(1);
  });
});
