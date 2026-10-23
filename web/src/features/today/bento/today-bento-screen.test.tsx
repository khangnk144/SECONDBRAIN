import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiStatusStore } from '../../../lib/ai-status-store';
import { i18n } from '../../../i18n';
import type { FetchMock } from '../../../lib/testing/fetch-mock';
import { withStyle } from '../../../lib/testing/ui-style-test-kit';
import { useConnectionStore } from '../../../lib/ws/connection-store';
import { emitServerEvent } from '../../../lib/ws/server-event-bus';
import { aiStatus } from '../../ai-chat/chat-test-kit';
import { TodayScreen } from '../today-screen';
import { project, stubWindow, taskEntry, taskItem, TODAY, todayView } from '../today-test-fixtures';
import { activity, brain, setUpBento } from './bento-test-kit';

const dueToday = taskItem('Làm BT1 Giải tích', TODAY);
const later = taskItem('Thi giữa kỳ', '2026-10-22');
const VIEW = todayView({
  days: { [TODAY]: [dueToday], '2026-10-22': [later] },
  todayTasks: [taskEntry(dueToday)],
  projects: [project()],
  summary: { deadlinesThisWeek: 2, openToday: 1 },
});
const FULL = {
  ...VIEW,
  activity: activity([2, 4, 1, 5, 3, 6, 3], {
    doneYesterday: 4,
    brain: brain({ notesNew: 1, notesTouched: 3, linksAdded: 7, nodes: [] }),
  }),
};

/** Tile names in DOM order (each tile is a region named by its heading). */
const tileNames = () =>
  [...document.querySelectorAll('.today-bento__grid > section')].map((tile) => {
    const id = tile.getAttribute('aria-labelledby') ?? '';
    return document.getElementById(id)?.textContent?.trim();
  });

describe('Bento Today (F35.4)', () => {
  let mock: FetchMock;
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    ({ mock } = await setUpBento());
    restoreWindow = stubWindow(1280);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 18, 30));
    mock.on('GET /api/today', { body: FULL });
  });
  afterEach(() => {
    restoreWindow();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('(F35.4) tiles come in the reading order of design.md §12.3, each with its heading', async () => {
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(tileNames()).toEqual([
      'Chào buổi tối,khangnie',
      'Ngày hôm nay',
      'Deadline gần nhất',
      '14 ngày tới',
      'Hôm nay',
      'Đồ án đang làm',
      'Não hôm nay',
      'Ghi nhanh',
      '7 ngày ghi chép',
    ]);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chào buổi tối,khangnie');
    expect(screen.getByRole('region', { name: 'Ngày hôm nay' })).toHaveTextContent(
      'Thứ ba, 20 tháng 10, 2026',
    );
    expect(screen.getByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.')).toBeInTheDocument();
    // The calm layout is not there.
    expect(document.querySelector('.today')).toBeNull();
  });

  it('(F35.4) Tab walks the tiles in the same order', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    const tiles = [...document.querySelectorAll('.today-bento__grid > *')];
    const order: number[] = [];
    // One pass, until focus wraps around to the first tile again.
    for (let i = 0; i < 20; i += 1) {
      await user.tab();
      const index = tiles.findIndex((tile) => tile.contains(document.activeElement));
      if (index >= 0 && index < (order.at(-1) ?? -1)) break;
      if (index >= 0) order.push(index);
    }
    // Deadline title, strip, task checkbox and title, ring title, brain link, capture field and
    // button (the greeting and date tiles hold nothing to tab to; the review is empty today).
    expect(order).toEqual([2, 3, 5, 5, 6, 7, 8, 8]);
  });

  it('switching the style swaps the layout at once, with the same data', async () => {
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(document.querySelector('.today-bento')).not.toBeNull();
    act(() => void withStyle('calm'));
    expect(document.querySelector('.today-bento')).toBeNull();
    expect(await screen.findByRole('group', { name: 'Các ngày tới' })).toBeInTheDocument();
    expect(document.querySelector('.today')).not.toBeNull();
  });

  it('(F35.4) the AI line sits in the greeting tile only when AI is ready', async () => {
    const LINE = 'Ưu tiên bài tập Xác suất trước 23:59.';
    mock.on('GET /api/ai/today-summary', { body: { date: TODAY, text: LINE } });
    const { unmount } = render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(screen.queryByText(LINE)).toBeNull();
    unmount();
    useAiStatusStore.setState({ status: aiStatus() });
    render(<TodayScreen />);
    const line = await screen.findByText(LINE);
    expect(line.closest('.today-tile--greeting')).not.toBeNull();
    expect(line.closest('p')).toHaveTextContent(`AITrợ lý AI: ${LINE}`);
  });

  it('(F24.4, F34) an AI ingest that just finished refreshes the counts', async () => {
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    const before = mock.callsTo('GET /api/today').length;
    act(() =>
      emitServerEvent({
        type: 'ai:touched',
        source: '3 Resources/papers/Bài báo.pdf',
        outputs: ['wiki/Ma trận.md'],
      }),
    );
    await waitFor(() => expect(mock.callsTo('GET /api/today')).toHaveLength(before + 1));
  });

  it("(F35.4) offline: the banner takes the summary's place; the sample question comes first and hides", async () => {
    mock.on('GET /api/sample-data', { body: { offered: true, present: false } });
    render(<TodayScreen />);
    const card = await screen.findByRole('region', { name: 'Tạo dữ liệu mẫu để xem thử?' });
    expect(card.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    await screen.findByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.');
    act(() => useConnectionStore.setState({ state: 'closed', closedSince: Date.now() - 5_000 }));
    const banner = await screen.findByText(/Chưa kết nối với máy chủ/);
    expect(banner.closest('.today-tile--greeting')).not.toBeNull();
    expect(screen.queryByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Tạo dữ liệu mẫu để xem thử?' })).toBeNull();
  });

  it('has English copy', async () => {
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Coming days' });
    expect(tileNames()).toEqual([
      'Good evening,khangnie',
      "Today's date",
      'Nearest deadline',
      'Next 14 days',
      'Today',
      'Projects in progress',
      "Today's brain",
      'Quick capture',
      'Last 7 days of writing',
    ]);
    expect(screen.getByText('Yesterday you finished 4 tasks. Keep it up.')).toBeInTheDocument();
  });

  it('a load error offers a retry; the tiles keep their places', async () => {
    mock.on('GET /api/today', { status: 500, body: { error: { code: 'X', message: 'x' } } });
    render(<TodayScreen />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Không tải được việc hôm nay. Bạn thử lại nhé.');
    mock.on('GET /api/today', { body: FULL });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(within(alert.parentElement as HTMLElement).getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(tileNames()).toHaveLength(9);
  });
});
