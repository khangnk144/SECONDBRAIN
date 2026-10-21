/** Shared setup for the sidebar tree tests (not a test file itself). */
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { makeTree, type TreeFixture } from '../../lib/testing/tree-fixture';
import { useTreeStore } from '../../lib/tree-store';
import { todayView } from '../today/today-test-fixtures';

export const REV = 'c'.repeat(64);
export const FIXTURE: TreeFixture = {
  folders: ['0 Inbox', '1 Projects', '1 Projects/Đồ án Giải tích', '2 Areas', 'Daily'],
  notes: [
    '0 Inbox/Ý tưởng.md',
    '0 Inbox/Bài tập.md',
    '1 Projects/Đồ án Giải tích/Kế hoạch.md',
    '2 Areas/Giải tích 1.md',
    'Daily/2026-10-19.md',
    'Daily/2026-10-18.md',
    'Ghi chú gốc.md',
  ],
  urgent: ['1 Projects/Đồ án Giải tích'],
};

/** Visible tree labels in order. */
export const labels = () =>
  screen
    .getAllByRole('treeitem')
    .map((item) => item.querySelector('.tree-item__label')?.textContent);

/** The treeitem whose label is `name`. */
export const item = (name: string) =>
  screen
    .getAllByRole('treeitem')
    .find((el) => el.querySelector('.tree-item__label')?.textContent === name) as HTMLElement;

/** The toasts' polite live region (Today, where the app opens, has live regions of its own). */
export const toastStatus = () =>
  within(screen.getByRole('region', { name: 'Thông báo' })).getByRole('status');

export function renderApp(path = '/') {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

/** Clean stores, a fetch mock serving the fixture, Inbox and Daily expanded. */
export async function setupSidebarTest(): Promise<FetchMock> {
  await resetAppState('vault-a');
  const mock = installFetchMock();
  mock.on('GET /api/note', (call) => ({
    body: { path: call.query.get('path'), revision: REV, content: 'nội dung' },
  }));
  mock.on('GET /api/tree', { body: makeTree(FIXTURE) });
  // The app opens on Today: nothing due, no sample-data offer.
  mock.on('GET /api/today', { body: todayView() });
  mock.on('GET /api/sample-data', { body: { offered: false, present: false } });
  useTreeStore.setState({ tree: makeTree(FIXTURE), status: 'ready' });
  useTreeStore.getState().hydrate();
  useTreeStore.setState({ expanded: ['0 Inbox', 'Daily'] });
  return mock;
}

export function teardownSidebarTest(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}
