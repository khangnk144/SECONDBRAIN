import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { AiStatus } from '../../lib/api/ai-types';
import { useSearchUi } from '../../lib/search-ui-store';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { withStyle } from '../../lib/testing/ui-style-test-kit';
import { useToastStore } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { useVaultStore } from '../../lib/vault-store';
import { useInboxTidy } from '../ai-inbox/inbox-tidy-store';
import { useTreeReveal } from '../sidebar/tree-reveal';
import { reviewNotes, reviewTasks, weekReview } from './review-test-fixtures';
import { REVIEW_DISMISSED_KEY } from './review-week';
import { WeeklyReviewCard } from './weekly-review-card';

let mock: FetchMock;
let navigate: ReturnType<typeof vi.fn<Navigator>>;

/** Local time; months are 1-based here. */
const at = (mo: number, d: number, h: number, mi = 0) => new Date(2026, mo - 1, d, h, mi);

beforeEach(async () => {
  navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
  vi.useFakeTimers({ shouldAdvanceTime: true });
  mock = installFetchMock();
  mock.on('GET /api/review/week', (call) => ({ body: weekReview(call.query.get('end') ?? '') }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const heading = () => screen.queryByRole('heading', { name: 'Tổng kết tuần', level: 2 });
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe('weekly review card on Today (F26.1–F26.3)', () => {
  it('(F26.3) shows only on Sunday: Saturday 23:59 → Sunday 00:00 → Monday', async () => {
    vi.setSystemTime(at(3, 7, 23, 59));
    render(<WeeklyReviewCard variant="section" />);
    expect(heading()).toBeNull();
    expect(mock.callsTo('GET /api/review/week')).toHaveLength(0);

    advance(61_000);
    expect(await screen.findByRole('heading', { name: 'Tổng kết tuần', level: 2 })).toBeVisible();
    expect(mock.callsTo('GET /api/review/week')[0]?.query.get('end')).toBe('2026-03-08');
    expect(screen.getByText('2/3 – 8/3')).toBeInTheDocument();

    advance(24 * 60 * 60_000);
    expect(heading()).toBeNull();
  });

  it('(F26.1) Inbox, notes (≤ 8 + "Xem tất cả"), tasks done (≤ 8) and next week, from the API', async () => {
    vi.setSystemTime(at(3, 8, 10));
    mock.on('GET /api/review/week', {
      body: weekReview('2026-03-08', {
        notes: { count: 12, items: reviewNotes(12) },
        tasksDone: { count: 9, items: reviewTasks(9) },
      }),
    });
    render(<WeeklyReviewCard variant="section" />);
    await screen.findByText('Inbox có 4 ghi chú.');
    expect(screen.getByText('Bạn đã tạo hoặc sửa 12 ghi chú.')).toBeInTheDocument();
    expect(screen.getByText('Bạn đã xong 9 việc.')).toBeInTheDocument();
    expect(screen.getByText('Tuần tới có 2 deadline.')).toBeInTheDocument();
    const notes = screen.getByRole('region', { name: 'Ghi chép' });
    expect(within(notes).getAllByRole('listitem')).toHaveLength(8);
    expect(within(notes).getByText('mới')).toBeInTheDocument();
    const tasks = screen.getByRole('region', { name: 'Việc đã xong' });
    expect(within(tasks).getAllByRole('listitem')).toHaveLength(8);
    expect(within(tasks).getAllByText('trong Đồ án Giải tích')).toHaveLength(8);

    fireEvent.click(within(notes).getByRole('link', { name: 'Xem tất cả' }));
    expect(navigate).toHaveBeenLastCalledWith('/review', undefined);
    fireEvent.click(screen.getByRole('link', { name: 'Mở Việc cần làm' }));
    expect(navigate).toHaveBeenLastCalledWith('/tasks', undefined);
    fireEvent.click(within(notes).getByRole('button', { name: 'Ghi chú 1' }));
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toContain(
      '1 Projects/Ghi chú 1.md',
    );
    fireEvent.click(within(tasks).getByRole('button', { name: 'Việc 2' }));
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent('1 Projects/Đồ án Giải tích.md')}&line=7`,
      { replace: true },
    );
  });

  it('(F26.1) "Dọn Inbox" opens the tree at the Inbox without AI, the AI tidy dialog with AI ready', async () => {
    vi.setSystemTime(at(3, 8, 10));
    render(<WeeklyReviewCard variant="section" />);
    const tidy = await screen.findByRole('button', { name: 'Dọn Inbox' });
    expect(tidy).toHaveAccessibleDescription(/Mở cây thư mục ở Inbox/);
    fireEvent.click(tidy);
    // The tree shows the Inbox (tidy-inbox-tree.test.tsx follows it in the real shell).
    expect(useTreeStore.getState().expanded).toContain('0 Inbox');
    expect(useTreeReveal.getState().folder).toBe('0 Inbox');
    expect(useSearchUi.getState().open).toBe(false);
    expect(useInboxTidy.getState().mode).toBeNull();

    act(() =>
      useAiStatusStore.setState({
        status: {
          available: true,
          ready: true,
          reason: null,
          scope: ['0 Inbox'],
        } as unknown as AiStatus,
      }),
    );
    const withAi = screen.getByRole('button', { name: 'Dọn Inbox' });
    expect(withAi).toHaveAccessibleDescription(/gợi ý chỗ để của AI/);
    fireEvent.click(withAi);
    expect(useInboxTidy.getState().mode).toEqual({ kind: 'all' });
  });

  it('(F26.2) "Để sau" hides it until next Sunday, per vault', async () => {
    vi.setSystemTime(at(3, 8, 10));
    const { unmount } = render(<WeeklyReviewCard variant="section" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(heading()).toBeNull();
    expect(localStorage.getItem(`sb:vault-a:${REVIEW_DISMISSED_KEY}`)).toBe('"2026-W10"');
    expect(useToastStore.getState().toasts[0]?.message).toMatch(/Đã ẩn tổng kết tuần/);
    unmount();

    // Still hidden later that Sunday; another vault has its own choice.
    render(<WeeklyReviewCard variant="section" />);
    expect(heading()).toBeNull();
    act(() => useVaultStore.setState({ vaultId: 'vault-b' }));
    expect(await screen.findByRole('heading', { name: 'Tổng kết tuần', level: 2 })).toBeVisible();
    act(() => useVaultStore.setState({ vaultId: 'vault-a' }));
    expect(heading()).toBeNull();

    // The next Sunday it is back.
    vi.setSystemTime(at(3, 15, 9));
    act(() => window.dispatchEvent(new Event('focus')));
    expect(await screen.findByRole('heading', { name: 'Tổng kết tuần', level: 2 })).toBeVisible();
  });

  it('works when storage throws (it simply comes back)', async () => {
    vi.setSystemTime(at(3, 8, 10));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<WeeklyReviewCard variant="section" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Để sau' }));
    expect(heading()).toBeVisible();
    vi.restoreAllMocks();
  });

  it('is a quiet section in calm and a Bento tile in bento', async () => {
    vi.setSystemTime(at(3, 8, 10));
    const { container, unmount } = render(<WeeklyReviewCard variant="section" />);
    await screen.findByText('Inbox có 4 ghi chú.');
    expect(container.firstElementChild).toHaveClass('weekly-review', 'weekly-review--section');
    expect(container.firstElementChild).not.toHaveClass('tile');
    unmount();
    withStyle('bento');
    const tile = render(<WeeklyReviewCard variant="tile" />);
    await screen.findByText('Inbox có 4 ghi chú.');
    expect(tile.container.firstElementChild).toHaveClass('weekly-review--tile', 'tile');
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Inbox',
      'Ghi chép',
      'Việc đã xong',
      'Tuần tới',
    ]);
  });

  it('says so when it cannot load, with "Thử lại"', async () => {
    vi.setSystemTime(at(3, 8, 10));
    mock.on('GET /api/review/week', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    render(<WeeklyReviewCard variant="section" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được tổng kết tuần.');
    mock.on('GET /api/review/week', { body: weekReview('2026-03-08') });
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    await screen.findByText('Inbox có 4 ghi chú.');
  });
});
