import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vi_ from '../i18n/vi.json';
import { usePanesStore } from '../lib/panes-store';
import { useSearchUi } from '../lib/search-ui-store';
import { installFetchMock, type FetchMock } from '../lib/testing/fetch-mock';
import { resetAppState } from '../lib/testing/reset-app-state';
import { useWritingFocus } from '../lib/writing-focus-store';
import { appRoutes } from './routes';
import { hydrateVaultState } from './start-app-services';

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  const view = render(<RouterProvider router={router} />);
  return { router, container: view.container };
}
const notePath = '1 Projects/Đồ án Giải tích.md';
const noteUrl = `/note?path=${encodeURIComponent(notePath)}`;

describe('app shell: routes, panes and shortcuts', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
    mock.on('GET /api/note', {
      body: { path: notePath, revision: 'r', content: '# Đồ án\n- [ ] Nộp' },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('note route shows the title and the note body with the right pane and the tab bar', async () => {
    renderAt(noteUrl);
    expect(await screen.findByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveValue(
      'Đồ án Giải tích',
    );
    expect(await screen.findByRole('textbox', { name: /Nội dung ghi chú/ })).toHaveTextContent(
      'Nộp',
    );
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' })).toBeInTheDocument();
  });

  it('tags route shows the "Thẻ" stub and marks its nav item', () => {
    renderAt('/tags');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(vi_.nav.tags);
    expect(screen.getByRole('link', { name: vi_.nav.tags })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('Alt+1 / Alt+2 and the visible buttons collapse the panes, remembered per vault', async () => {
    const user = userEvent.setup();
    renderAt(noteUrl);
    await user.keyboard('{Alt>}1{/Alt}');
    expect(screen.queryByRole('complementary', { name: vi_.sidebar.label })).toBeNull();
    expect(JSON.parse(localStorage.getItem('sb:vault-a:panes') ?? '{}')).toEqual({
      leftCollapsed: true,
      rightCollapsed: false,
    });
    await user.click(screen.getByRole('button', { name: vi_.panes.showLeft }));
    expect(screen.getByRole('complementary', { name: vi_.sidebar.label })).toBeInTheDocument();
    await user.keyboard('{Alt>}2{/Alt}');
    expect(screen.queryByRole('complementary', { name: vi_.panel.label })).toBeNull();
    await user.click(screen.getByRole('button', { name: vi_.panes.showRight }));
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();

    act(() => usePanesStore.getState().toggleLeft());
    usePanesStore.setState({ leftCollapsed: false });
    act(() => hydrateVaultState());
    expect(usePanesStore.getState().leftCollapsed).toBe(true);
  });

  it('writing focus fades both panes until the mouse moves', () => {
    const { container } = renderAt(noteUrl);
    act(() => useWritingFocus.getState().setFocused(true));
    const shell = container.querySelector('.app-shell') as HTMLElement;
    expect(shell).toHaveClass('app-shell--writing');
    fireEvent.mouseMove(shell);
    expect(shell).not.toHaveClass('app-shell--writing');
  });

  it('Ctrl+K and the sidebar search box open the search UI', async () => {
    const user = userEvent.setup();
    renderAt('/');
    await user.keyboard('{Control>}k{/Control}');
    expect(useSearchUi.getState().open).toBe(true);
    act(() => useSearchUi.getState().close());
    await user.click(screen.getByRole('button', { name: vi_.sidebar.searchLabel }));
    expect(useSearchUi.getState().open).toBe(true);
  });

  it('Alt+N asks for a template, creates the note in Inbox and opens it as new', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/templates', {
      body: {
        templates: [{ path: 'Templates/Lecture.md', title: 'Lecture', bundled: true }],
        missingBundled: [],
      },
    });
    mock.on('POST /api/note', {
      status: 201,
      body: { path: '0 Inbox/Ghi chú mới.md', revision: 'r' },
    });
    const { router } = renderAt('/');
    await user.keyboard('{Alt>}n{/Alt}');
    const listbox = await screen.findByRole('listbox');
    expect(listbox).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/note'));
    expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
      path: '0 Inbox/Ghi chú mới.md',
      unique: true,
      template: 'Templates/Lecture.md',
    });
    // The note screen consumes `new=1`: it focuses the title and drops the flag from the URL.
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ })).toHaveFocus(),
    );
  });
});
