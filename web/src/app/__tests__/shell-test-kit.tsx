/** Shared setup for the shell tests (bento frame, drawers, phone layouts). Not a test file. */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { vi } from 'vitest';
import { setRouteReader } from '../../lib/app-navigation';
import { resetShellSession } from '../../lib/panes-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { makeTree } from '../../lib/testing/tree-fixture';
import { useTreeStore } from '../../lib/tree-store';
import { AppLayout } from '../app-layout';
import type { AppRouteHandle } from '../routes';

export const NOTE_PATH = '1 Projects/Đồ án Giải tích.md';
export const noteUrl = (path = NOTE_PATH) => `/note?path=${encodeURIComponent(path)}`;

function StubPanel() {
  return (
    <section className="panel-section" aria-label="Thuộc tính">
      <button type="button">Nút trong ngăn phải</button>
    </section>
  );
}

/** A screen with a primary button of its own (F35.3). */
function PrimaryScreen() {
  return (
    <div>
      <h1>Có nút chính</h1>
      <button type="button" className="button button--primary">
        Gửi
      </button>
    </div>
  );
}

/** Two radios like Settings → "Phong cách" (the screen is mounted again by a style switch). */
function StyleRadios() {
  return (
    <fieldset>
      <legend>Phong cách</legend>
      {['bento', 'calm'].map((value) => (
        <label key={value}>
          <input type="radio" name="settings-style" value={value} />
          {value}
        </label>
      ))}
    </fieldset>
  );
}

const noteHandle: AppRouteHandle = { rightPanel: true, tabs: true, panel: StubPanel };
const calendarHandle: AppRouteHandle = { rightPanel: true, panel: StubPanel };

/** The real layout around stub screens, so the frame is tested apart from the screens. */
export const shellRoutes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <h1>Màn hình Hôm nay</h1>, handle: { inlineConnectionBanner: true } },
      { path: 'tasks', element: <h1>Màn hình Việc</h1> },
      { path: 'calendar', element: <h1>Màn hình Lịch</h1>, handle: calendarHandle },
      { path: 'graph', element: <h1>Màn hình Não</h1>, handle: { immersive: true } },
      { path: 'note', element: <h1>Màn hình ghi chú</h1>, handle: noteHandle },
      { path: 'file', element: <h1>Màn hình tài liệu</h1>, handle: noteHandle },
      { path: 'settings', element: <h1>Màn hình Cài đặt</h1> },
      { path: 'reminders', element: <h1>Màn hình Nhắc nhở</h1> },
      { path: 'ask', element: <PrimaryScreen /> },
      { path: 'radios', element: <StyleRadios /> },
      { path: '*', element: <h1>Khác</h1> },
    ],
  },
];

export function renderShell(path = '/') {
  const router = createMemoryRouter(shellRoutes, { initialEntries: [path] });
  // Like App: the live route, so a drawer closed by a navigation leaves focus to the new screen.
  setRouteReader(() => router.state.location);
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

export const TREE = makeTree({
  folders: ['0 Inbox', '1 Projects', 'Daily'],
  notes: ['0 Inbox/Ý tưởng.md', NOTE_PATH, 'Daily/2026-10-22.md'],
});

/** Clean stores (vault `vaultId`), a fetch mock with the tree, the tree loaded. */
export async function setupShell(vaultId = 'vault-a'): Promise<FetchMock> {
  await resetAppState(vaultId);
  resetShellSession();
  const mock = installFetchMock();
  mock.on('GET /api/tree', { body: TREE });
  useTreeStore.setState({ tree: TREE, status: 'ready', expanded: ['0 Inbox', '1 Projects'] });
  return mock;
}

/**
 * `window.matchMedia` answering `(max-width: Npx)` like a window `width` px wide (jsdom has no
 * layout). Returns the function that removes it.
 */
export function stubViewport(width: number): () => void {
  const matchMedia = vi.fn((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  };
}

export function teardownShell(): void {
  setRouteReader(() => ({ pathname: '/', search: '' }))();
  delete (window as { matchMedia?: unknown }).matchMedia;
  vi.unstubAllGlobals();
}
