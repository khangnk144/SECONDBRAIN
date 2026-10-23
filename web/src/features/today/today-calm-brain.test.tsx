import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { withStyle } from '../../lib/testing/ui-style-test-kit';
import { activity, brain, setUpBento } from './bento/bento-test-kit';
import { TodayScreen } from './today-screen';
import { stubWindow, todayView } from './today-test-fixtures';

// R owns the card; here only its place on the screen and the variant asked for matter.
vi.mock('../review/weekly-review-card', () => ({
  WeeklyReviewCard: ({ variant }: { variant: string }) => (
    <section aria-label="weekly-review" data-variant={variant} />
  ),
}));

const NODES = [
  { path: '1 Projects/Đồ án Giải tích.md', title: 'Đồ án Giải tích', group: 'projects' as const },
  { path: 'wiki/Ma trận.md', title: 'Ma trận', group: 'wiki' as const },
];

describe('Calm Today: "não hôm nay" block and the weekly review (F24.4, F26)', () => {
  let mock: FetchMock;
  let navigate: Navigator;
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    ({ mock, navigate } = await setUpBento('calm'));
    restoreWindow = stubWindow(1280);
  });
  afterEach(() => {
    restoreWindow();
    vi.unstubAllGlobals();
  });

  it("(F24.4) a small block top right: a few dots, the counts in words, a link to today's map", async () => {
    const user = userEvent.setup();
    const today = activity([0, 0, 0, 0, 0, 0, 5], {
      brain: brain({ notesNew: 3, notesTouched: 5, linksAdded: 7, aiTouched: 1, nodes: NODES }),
    });
    mock.on('GET /api/today', { body: { ...todayView(), activity: today } });
    render(<TodayScreen />);
    const link = await screen.findByRole('link', {
      name: 'Não hôm nay: 3 ghi chú mới, 2 ghi chú đã sửa, 7 liên kết mới, AI cập nhật 1 trang. Mở Bản đồ não với các ghi chú hôm nay.',
    });
    expect(link).toHaveTextContent(
      '3 ghi chú mới, 2 ghi chú đã sửa, 7 liên kết mới, AI cập nhật 1 trang',
    );
    expect(link.querySelectorAll('circle')).toHaveLength(2);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    // Beside the greeting, in the head of the screen.
    expect(link.closest('.today__head')).not.toBeNull();
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/graph?when=today', undefined);
  });

  it('(F24.4) stays away on a day without activity and when the server sent none', async () => {
    mock.on('GET /api/today', { body: { ...todayView(), activity: activity() } });
    const { unmount } = render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(document.querySelector('.today-brain-line')).toBeNull();
    unmount();
    mock.on('GET /api/today', { body: todayView() });
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(document.querySelector('.today-brain-line')).toBeNull();
  });

  it('(F26) the review sits after the summary and before the strip, as a section', async () => {
    mock.on('GET /api/today', { body: todayView() });
    render(<TodayScreen />);
    const strip = await screen.findByRole('group', { name: 'Các ngày tới' });
    const review = screen.getByRole('region', { name: 'weekly-review' });
    expect(review).toHaveAttribute('data-variant', 'section');
    const summary = document.querySelector('.today__summary') as HTMLElement;
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(summary, review)).toBe(true);
    expect(follows(review, strip)).toBe(true);
    expect(
      within(document.querySelector('.today') as HTMLElement).getAllByRole('heading', { level: 1 }),
    ).toHaveLength(1);
  });

  it('(F26) Bento: the review is the full-width tile between the strip and "Hôm nay"', async () => {
    withStyle('bento');
    mock.on('GET /api/today', { body: todayView() });
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    const review = screen.getByRole('region', { name: 'weekly-review' });
    expect(review).toHaveAttribute('data-variant', 'tile');
    const slot = review.parentElement as HTMLElement;
    expect(slot).toHaveClass('today-bento__review');
    expect(slot.previousElementSibling).toHaveClass('today-tile--strip');
    expect(slot.nextElementSibling).toHaveClass('today-tile--tasks');
  });
});
