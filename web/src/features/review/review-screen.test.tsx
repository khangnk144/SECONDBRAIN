import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppNavigator } from '../../lib/app-navigation';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { reviewNotes, weekReview } from './review-test-fixtures';
import { ReviewScreen } from './review-screen';

let mock: FetchMock;

function renderScreen(entry = '/review') {
  const router = createMemoryRouter([{ path: '/review', element: <ReviewScreen /> }], {
    initialEntries: [entry],
  });
  // The app's navigator, as the layout registers it.
  setAppNavigator((to, options) => void router.navigate(to, options));
  render(<RouterProvider router={router} />);
  return router;
}

const ends = () => mock.callsTo('GET /api/review/week').map((call) => call.query.get('end'));

beforeEach(async () => {
  await resetAppState('vault-a');
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // A Wednesday: the screen works any day (F26.2).
  vi.setSystemTime(new Date(2026, 2, 11, 10, 0));
  mock = installFetchMock();
  mock.on('GET /api/review/week', (call) => ({ body: weekReview(call.query.get('end') ?? '') }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('#/review (F26.2)', () => {
  it('(F26.2) shows the week ending today any day, and steps a week back and forth', async () => {
    const router = renderScreen();
    expect(screen.getByRole('heading', { name: 'Tổng kết tuần', level: 1 })).toBeInTheDocument();
    await screen.findByText('Inbox có 4 ghi chú.');
    expect(ends()).toEqual(['2026-03-11']);
    expect(screen.getByText('5/3 – 11/3')).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Tuần sau' });
    expect(next).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(next);
    expect(ends()).toEqual(['2026-03-11']);

    fireEvent.click(screen.getByRole('button', { name: 'Tuần trước' }));
    await waitFor(() => expect(router.state.location.search).toBe('?end=2026-03-04'));
    await screen.findByText('26/2 – 4/3');
    expect(ends()).toContain('2026-03-04');
    const back = screen.getByRole('button', { name: 'Tuần sau' });
    expect(back).not.toHaveAttribute('aria-disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Về tuần này' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
    await screen.findByText('5/3 – 11/3');
  });

  it('lists everything the server sent and says how many more there are', async () => {
    mock.on('GET /api/review/week', {
      body: weekReview('2026-03-11', { notes: { count: 60, items: reviewNotes(50) } }),
    });
    renderScreen();
    const notes = await screen.findByRole('region', { name: 'Ghi chép' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(50);
    expect(within(notes).getByText('Còn 10 ghi chú nữa.')).toBeInTheDocument();
    expect(within(notes).queryByRole('link', { name: 'Xem tất cả' })).toBeNull();
  });

  it('a date after today or not a date shows this week', async () => {
    renderScreen('/review?end=2026-03-30');
    await screen.findByText('5/3 – 11/3');
    expect(ends()).toEqual(['2026-03-11']);
  });
});
