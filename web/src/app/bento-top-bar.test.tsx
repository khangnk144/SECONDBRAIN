import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import vi_ from '../i18n/vi.json';
import { useSearchUi } from '../lib/search-ui-store';
import type { FetchMock } from '../lib/testing/fetch-mock';
import { withStyle } from '../lib/testing/ui-style-test-kit';
import { AppLayout } from './app-layout';
import { renderShell, setupShell, teardownShell } from './__tests__/shell-test-kit';

const newNote = () => screen.getByRole('button', { name: 'Ghi chú mới' });

/** A screen whose primary button comes and goes (like Today's sample-data card). */
function TogglingPrimary() {
  const [shown, setShown] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setShown((value) => !value)}>
        Đổi
      </button>
      {shown ? (
        <button type="button" className="button button--primary">
          Tạo dữ liệu mẫu
        </button>
      ) : null}
    </div>
  );
}

describe('bento top bar (F35.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupShell();
    withStyle('bento');
  });
  afterEach(() => teardownShell());

  it('(F35.3) the search field opens the palette, like Ctrl+K', async () => {
    const user = userEvent.setup();
    renderShell('/');
    const search = screen.getByRole('button', { name: 'Tìm ghi chú hoặc hỏi AI' });
    expect(search).toHaveTextContent('Tìm ghi chú hoặc hỏi AI…');
    expect(search).toHaveTextContent('Ctrl K');
    expect(search).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(search);
    expect(useSearchUi.getState().open).toBe(true);
    act(() => useSearchUi.getState().close());
    await user.keyboard('{Control>}k{/Control}');
    expect(useSearchUi.getState().open).toBe(true);
  });

  it('(F35.3) "Ghi chú mới" runs the Alt+N command: template, note in Inbox, opened as new', async () => {
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
    const { router } = renderShell('/');
    expect(newNote()).toHaveAttribute('aria-keyshortcuts', 'Alt+N');
    expect(newNote()).toHaveAttribute('title', 'Ghi chú mới (Alt+N)');
    await user.click(newNote());
    await screen.findByRole('listbox');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/note'));
    expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
      path: '0 Inbox/Ghi chú mới.md',
      unique: true,
      template: 'Templates/Lecture.md',
    });
  });

  it('(F35.3) one primary per screen: the top bar is primary only where the screen has none', async () => {
    const { router } = renderShell('/');
    expect(newNote()).toHaveClass('button--primary');
    // "Hỏi AI"-like screen with its own primary ("Gửi").
    await act(() => router.navigate('/ask'));
    expect(newNote()).toHaveClass('button--secondary');
    expect(newNote()).not.toHaveClass('button--primary');
    expect(document.querySelectorAll('.button--primary')).toHaveLength(1);
    await act(() => router.navigate('/tasks'));
    expect(newNote()).toHaveClass('button--primary');
  });

  it('(F35.3) a primary that appears later on the screen turns the top bar button secondary', async () => {
    const user = userEvent.setup();
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <AppLayout />,
          children: [{ index: true, element: <TogglingPrimary /> }],
        },
      ],
      { initialEntries: ['/'] },
    );
    render(<RouterProvider router={router} />);
    expect(newNote()).toHaveClass('button--primary');
    await user.click(screen.getByRole('button', { name: 'Đổi' }));
    await waitFor(() => expect(newNote()).toHaveClass('button--secondary'));
    await user.click(screen.getByRole('button', { name: 'Đổi' }));
    await waitFor(() => expect(newNote()).toHaveClass('button--primary'));
  });

  it('(F35.3) routes with a right panel keep the Alt+2 toggle; note routes keep the tab row', async () => {
    const user = userEvent.setup();
    const { router } = renderShell('/calendar');
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: vi_.panes.hideRight }));
    expect(screen.queryByRole('complementary', { name: vi_.panel.label })).toBeNull();
    await user.keyboard('{Alt>}2{/Alt}');
    expect(screen.getByRole('complementary', { name: vi_.panel.label })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Thẻ ghi chú đang mở' })).toBeNull();
    await act(() => router.navigate('/note?path=a.md'));
    expect(screen.getByRole('navigation', { name: 'Thẻ ghi chú đang mở' })).toBeInTheDocument();
    // Today has neither.
    await act(() => router.navigate('/'));
    expect(screen.queryByRole('button', { name: vi_.panes.hideRight })).toBeNull();
    expect(screen.queryByRole('button', { name: vi_.panes.showRight })).toBeNull();
  });
});
