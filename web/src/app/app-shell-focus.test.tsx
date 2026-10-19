import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import vi_ from '../i18n/vi.json';
import { useTabsStore } from '../lib/tabs-store';
import { installFetchMock } from '../lib/testing/fetch-mock';
import { resetAppState } from '../lib/testing/reset-app-state';
import { appRoutes } from './routes';

const A = '1 Projects/Đồ án Giải tích.md';
const B = '2 Areas/Xác suất.md';
const url = (path: string) => `/note?path=${encodeURIComponent(path)}`;
const body = () => screen.findByRole('textbox', { name: /Nội dung ghi chú/ });

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('keyboard focus never falls to <body> (WCAG 2.4.3)', () => {
  beforeAll(() => {
    // jsdom has no layout: ProseMirror asks a Range for its boxes when it scrolls the caret.
    const range = Range.prototype as unknown as Record<string, unknown>;
    range.getClientRects ??= () => [];
    range.getBoundingClientRect ??= () => new DOMRect();
  });
  beforeEach(async () => {
    await resetAppState('vault-a');
    const mock = installFetchMock();
    mock.on('GET /api/note', (call) => {
      const path = call.query.get('path') ?? '';
      return {
        body: {
          path,
          revision: 'r'.repeat(64),
          content: `Nội dung của ${path}`,
          utf8: true,
          mtime: 0,
          frontmatter: null,
          frontmatterError: null,
          backlinks: [],
          outlinks: [],
          tags: [],
          class: 'user',
        },
      };
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Alt+[ from the editor lands in the newly active note editor', async () => {
    const user = userEvent.setup();
    renderAt(url(A));
    await body();
    act(() => useTabsStore.getState().openNote(B, { newTab: true }));
    await waitFor(async () => expect(await body()).toHaveTextContent('Xác suất'));
    act(() => screen.getByRole('textbox', { name: /Nội dung ghi chú/ }).focus());
    await user.keyboard('{Alt>}[[{/Alt}');
    await waitFor(() => {
      const editor = screen.getByRole('textbox', { name: /Nội dung ghi chú/ });
      expect(editor).toHaveTextContent('Đồ án Giải tích');
      expect(editor).toHaveFocus();
    });
  });

  it('Alt+W on the last tab from the editor goes to Today with focus on the main region', async () => {
    const user = userEvent.setup();
    const router = renderAt(url(A));
    act(() => {
      void body().then((editor) => editor.focus());
    });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /Nội dung ghi chú/ })).toHaveFocus(),
    );
    await user.keyboard('{Alt>}w{/Alt}');
    expect(router.state.location.pathname).toBe('/');
    await waitFor(() => expect(screen.getByRole('main')).toHaveFocus());
  });

  it('Alt+1 while focus is in the left pane moves focus to the main region', async () => {
    const user = userEvent.setup();
    renderAt('/');
    act(() => screen.getByRole('button', { name: vi_.sidebar.searchLabel }).focus());
    await user.keyboard('{Alt>}1{/Alt}');
    expect(screen.queryByRole('complementary', { name: vi_.sidebar.label })).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
