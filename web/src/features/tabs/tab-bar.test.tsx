import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appRoutes } from '../../app/routes';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}
const notePath = (router: ReturnType<typeof renderAt>) =>
  new URLSearchParams(router.state.location.search).get('path');

describe('tab bar (F23)', () => {
  beforeEach(async () => {
    await resetAppState('vault-a');
    const mock = installFetchMock();
    mock.on('GET /api/note', (call) => ({
      body: { path: call.query.get('path'), revision: 'r', content: `# ${call.query.get('path')}` },
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mirrors a deep link into a tab and keeps route and active tab in sync', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/note?path=${encodeURIComponent('2 Areas/Giải tích 1.md')}`);
    const nav = screen.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' });
    expect(within(nav).getByRole('button', { name: 'Giải tích 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    act(() => useTabsStore.getState().openNote('0 Inbox/Ý tưởng.md', { newTab: true }));
    expect(notePath(router)).toBe('0 Inbox/Ý tưởng.md');
    await user.click(within(nav).getByRole('button', { name: 'Giải tích 1' }));
    expect(notePath(router)).toBe('2 Areas/Giải tích 1.md');
    // Back/forward moves the active tab along.
    await act(async () => {
      await router.navigate(-1);
    });
    expect(notePath(router)).toBe('0 Inbox/Ý tưởng.md');
    expect(within(nav).getByRole('button', { name: 'Ý tưởng' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('closes with the × button, a middle click or Alt+W; the last tab returns to Today', async () => {
    const user = userEvent.setup();
    const router = renderAt(`/note?path=${encodeURIComponent('a.md')}`);
    act(() => useTabsStore.getState().openNote('b.md', { newTab: true }));
    act(() => useTabsStore.getState().openNote('c.md', { newTab: true }));
    await user.click(screen.getByRole('button', { name: 'Đóng thẻ c' }));
    expect(notePath(router)).toBe('b.md');
    fireEvent.mouseDown(screen.getByRole('button', { name: 'a' }), { button: 1 });
    fireEvent(
      screen.getByRole('button', { name: 'a' }),
      new MouseEvent('auxclick', { bubbles: true, button: 1 }),
    );
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['b.md']);
    await user.keyboard('{Alt>}w{/Alt}');
    expect(router.state.location.pathname).toBe('/');
    expect(screen.queryByRole('navigation', { name: 'Thẻ ghi chú đang mở' })).toBeNull();
  });
});
