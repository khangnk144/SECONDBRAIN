import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../app/app-layout';
import { setupShell, stubViewport, teardownShell } from '../../app/__tests__/shell-test-kit';
import { setRouteReader } from '../../lib/app-navigation';
import { usePanesStore } from '../../lib/panes-store';
import { useSearchUi } from '../../lib/search-ui-store';
import { withStyle } from '../../lib/testing/ui-style-test-kit';
import { useTreeStore } from '../../lib/tree-store';
import { weekReview } from './review-test-fixtures';
import { WeeklyReviewCard } from './weekly-review-card';

/** Today with the weekly review in the real frame (rail or sidebar, folder drawer). */
function renderToday() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [{ index: true, element: <WeeklyReviewCard variant="tile" /> }],
      },
    ],
    { initialEntries: ['/'] },
  );
  setRouteReader(() => router.state.location);
  render(<RouterProvider router={router} />);
}

/** The top-level "0 Inbox" row of the tree inside `container`. */
function inboxRow(container: HTMLElement): HTMLElement {
  const row = within(container)
    .getAllByRole('treeitem')
    .find((item) => item.getAttribute('aria-level') === '1' && item.textContent?.includes('Inbox'));
  if (!row) throw new Error('no Inbox row');
  return row;
}

async function pressTidy() {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Dọn Inbox' }));
  return user;
}

describe('"Dọn Inbox" without AI opens the folder tree at the Inbox (F26.1)', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 2, 8, 10, 0)); // a Sunday: the review is on Today
    const mock = await setupShell();
    mock.on('GET /api/review/week', (call) => ({ body: weekReview(call.query.get('end') ?? '') }));
    useTreeStore.setState({ expanded: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    teardownShell();
  });

  it('(F26.1) bento: the folder drawer opens with 0 Inbox expanded, selected and focused', async () => {
    withStyle('bento');
    stubViewport(1280);
    renderToday();
    const user = await pressTidy();
    const drawer = await screen.findByRole('dialog', { name: 'Thư mục' });
    const row = inboxRow(drawer);
    await waitFor(() => expect(row).toHaveFocus());
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(within(drawer).getByRole('treeitem', { name: /Ý tưởng/ })).toBeInTheDocument();
    expect(useSearchUi.getState().open).toBe(false);

    // Esc closes the drawer and focus goes back to the button she pressed.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Thư mục' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dọn Inbox' })).toHaveFocus();
  });

  it('(F26.1) calm: a hidden sidebar comes back with the Inbox row focused', async () => {
    stubViewport(1280);
    usePanesStore.setState({ leftCollapsed: true });
    renderToday();
    expect(screen.queryByRole('tree')).toBeNull();
    await pressTidy();
    const tree = await screen.findByRole('tree');
    const row = inboxRow(tree);
    await waitFor(() => expect(row).toHaveFocus());
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(usePanesStore.getState().leftCollapsed).toBe(false);
  });

  it('(F26.1) calm on a phone: the sidebar drawer opens on the Inbox row, not on the first link', async () => {
    stubViewport(360);
    renderToday();
    await pressTidy();
    const drawer = await screen.findByRole('dialog');
    const row = inboxRow(drawer);
    await waitFor(() => expect(row).toHaveFocus());
    expect(row).toHaveAttribute('aria-selected', 'true');
  });
});
