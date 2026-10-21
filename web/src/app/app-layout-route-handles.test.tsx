import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vi_ from '../i18n/vi.json';
import { usePanesStore } from '../lib/panes-store';
import { useRecentNotes } from '../lib/recent-notes-store';
import { installFetchMock, type FetchMock } from '../lib/testing/fetch-mock';
import { resetAppState } from '../lib/testing/reset-app-state';
import { useConnectionStore } from '../lib/ws/connection-store';
import { AppLayout } from './app-layout';
import { appRoutes, type AppRouteHandle } from './routes';

/** A route table of its own, so the layout rules are tested apart from the real screens. */
const testRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <h1>Hôm nay</h1>, handle: { inlineConnectionBanner: true } },
      { path: 'immersive', element: <h1>Bản đồ</h1>, handle: { immersive: true } },
      { path: 'plain', element: <h1>Thẻ</h1> },
    ],
  },
];

function renderAt(routes: RouteObject[], path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const leftPane = () => screen.queryByRole('complementary', { name: vi_.sidebar.label });
const offline = () => screen.queryByText(/Chưa kết nối với máy chủ/);

describe('route handles: immersive panes, inline banner, M3 routes', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('an immersive route hides both panes without touching the stored preference', async () => {
    const user = userEvent.setup();
    const router = renderAt(testRoutes, '/plain');
    expect(leftPane()).toBeInTheDocument();
    await act(() => router.navigate('/immersive'));
    expect(leftPane()).toBeNull();
    expect(screen.getByRole('button', { name: vi_.panes.showLeft })).toBeInTheDocument();
    // Alt+1 shows the pane for this visit only.
    await user.keyboard('{Alt>}1{/Alt}');
    expect(leftPane()).toBeInTheDocument();
    expect(localStorage.getItem('sb:vault-a:panes')).toBeNull();
    expect(usePanesStore.getState().leftCollapsed).toBe(false);
    await act(() => router.navigate('/plain'));
    expect(leftPane()).toBeInTheDocument();
    // Coming back hides them again.
    await act(() => router.navigate('/immersive'));
    expect(leftPane()).toBeNull();
    await act(() => router.navigate('/plain'));
    await user.keyboard('{Alt>}1{/Alt}');
    expect(leftPane()).toBeNull();
    expect(JSON.parse(localStorage.getItem('sb:vault-a:panes') ?? '{}')).toMatchObject({
      leftCollapsed: true,
    });
  });

  it('a route with inlineConnectionBanner leaves out the global banner', async () => {
    useConnectionStore.setState({ state: 'closed', closedSince: Date.now() - 5_000 });
    const router = renderAt(testRoutes, '/');
    expect(screen.getByRole('heading', { name: 'Hôm nay' })).toBeInTheDocument();
    expect(offline()).toBeNull();
    await act(() => router.navigate('/plain'));
    expect(offline()).toBeInTheDocument();
    expect(offline()?.closest('.connection-banner')).toHaveClass('connection-banner--global');
  });

  it('the real table: Today inline banner, tasks stub, calendar with its right pane, graph immersive', async () => {
    const children = appRoutes[0]?.children ?? [];
    const handleOf = (path?: string) =>
      children.find((r) => (path ? r.path === path : r.index === true))?.handle as
        AppRouteHandle | undefined;
    expect(handleOf()).toEqual({ inlineConnectionBanner: true });
    expect(handleOf('graph')).toEqual({ immersive: true });
    expect(handleOf('calendar')?.rightPanel).toBe(true);

    const router = renderAt(appRoutes, '/tasks');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(vi_.nav.tasks);
    await act(() => router.navigate('/calendar'));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(vi_.nav.calendar);
    const panel = screen.getByRole('complementary', { name: vi_.panel.label });
    expect(panel).toHaveTextContent(vi_.placeholder.calendarDay.title);
    expect(screen.getByRole('button', { name: vi_.panes.hideRight })).toBeInTheDocument();
  });

  it('every note the note route shows is recorded as recently opened', async () => {
    const path = '1 Projects/Đồ án Giải tích.md';
    mock.on('GET /api/note', { body: { path, revision: 'r', content: '# Đồ án\n' } });
    renderAt(appRoutes, `/note?path=${encodeURIComponent(path)}`);
    await waitFor(() => expect(useRecentNotes.getState().paths).toEqual([path]));
  });
});
