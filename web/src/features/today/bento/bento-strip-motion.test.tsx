import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoAddDays } from '../../../lib/local-day';
import type { FetchMock } from '../../../lib/testing/fetch-mock';
import { emitServerEvent } from '../../../lib/ws/server-event-bus';
import { TodayScreen } from '../today-screen';
import {
  longTitle,
  project,
  stubStripWidth,
  stubWindow,
  taskEntry,
  taskItem,
  TODAY,
  todayView,
} from '../today-test-fixtures';
import { activity, setUpBento } from './bento-test-kit';

const BUSY_DAY = '2026-10-23';

function denseView() {
  const busy = Array.from({ length: 10 }, (_, i) =>
    taskItem(longTitle(`Việc ${String(i).padStart(2, '0')}`), BUSY_DAY),
  );
  const overdue = Array.from({ length: 30 }, (_, i) =>
    taskItem(longTitle(`Trễ ${String(i).padStart(2, '0')}`), isoAddDays(TODAY, -1 - (i % 5))),
  );
  const lone = taskItem('Nộp BT1 Giải tích', '2026-10-21');
  return {
    ...todayView({
      days: { [BUSY_DAY]: busy, '2026-10-21': [lone] },
      overdue,
      todayTasks: [taskEntry(lone)],
      projects: [project()],
    }),
    activity: activity([1, 2, 0, 3, 1, 2, 4]),
  };
}

const strip = () => document.querySelector<HTMLElement>('.today-strip') as HTMLElement;
const busyCell = () => screen.getByRole('button', { name: 'Thứ sáu, 23 tháng 10: 10 việc' });
const overdueCell = () => screen.getByRole('button', { name: 'Quá hạn: 30 việc' });

describe('Bento strip keeps every F10 rule (F35.4)', () => {
  let mock: FetchMock;
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    ({ mock } = await setUpBento());
    restoreWindow = stubWindow(1280);
    mock.on('GET /api/today', { body: denseView() });
  });
  afterEach(() => {
    restoreWindow();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('(F10.2) dense day: two labels and "+8", the overdue cell first, popovers list everything', async () => {
    const user = userEvent.setup();
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(strip()).toHaveClass('today-strip--bento');
    const tile = screen.getByRole('region', { name: '14 ngày tới' });
    expect(within(tile).getByText('30 việc quá hạn')).toBeInTheDocument();
    expect(overdueCell()).toHaveTextContent('Quá hạn (30)');
    expect(busyCell()).toHaveTextContent('+8');
    expect(busyCell().querySelectorAll('.today-strip__label')).toHaveLength(2);
    // Bento: a lone label wraps over two lines at most.
    const lone = screen.getByRole('button', { name: 'Thứ tư, 21 tháng 10: 1 việc' });
    const label = lone.querySelector<HTMLElement>('.today-strip__label');
    expect(label?.style.getPropertyValue('--today-label-lines')).toBe('2');
    const cells = within(screen.getByRole('group', { name: 'Các ngày tới' })).getAllByRole(
      'button',
    );
    expect(cells).toHaveLength(61);
    for (const cell of cells) expect(cell.querySelector('.today-strip__dot')).not.toBeNull();

    await user.click(busyCell());
    const day = screen.getByRole('dialog', { name: 'Thứ sáu, 23 tháng 10' });
    expect(within(day).getAllByRole('checkbox')).toHaveLength(10);
    await user.click(overdueCell());
    expect(
      within(screen.getByRole('dialog', { name: 'Quá hạn (30)' })).getAllByRole('checkbox'),
    ).toHaveLength(30);
  });

  it('(F10.3) keyboard only: Tab reaches the strip, arrows move, Enter opens, Esc returns', async () => {
    const user = userEvent.setup();
    Element.prototype.scrollIntoView = vi.fn();
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    // The deadline tile's title comes first, then the strip's one tab stop (today).
    await user.tab();
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName(
      'Hôm nay, thứ ba, 20 tháng 10: chưa có việc nào',
    );
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(overdueCell());
    await user.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('Thứ sáu, 18 tháng 12: chưa có việc nào');
    await user.keyboard('{Home}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(document.activeElement).toBe(busyCell());
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Thứ sáu, 23 tháng 10' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(busyCell());
  });

  it('(F10, FIX-B D1) the scrolled range replaces the overdue count; as many days as fit at ≥ 66 px', async () => {
    restoreWindow();
    restoreWindow = stubWindow(600);
    // The scroller gets 520 px beside the overdue cell: 7 cells of 67 px (Bento's rule, not the
    // calm "7 below 720 px" one; a wider scroller shows more days).
    stubStripWidth(600, 80);
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(strip()).toHaveAttribute('data-visible-days', '7');
    const scroller = document.querySelector('.today-strip__scroller') as HTMLElement;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 6000 });
    scroller.scrollLeft = 1200;
    fireEvent.scroll(scroller);
    const tile = screen.getByRole('region', { name: '14 ngày tới' });
    expect(tile.querySelector('.today-strip__aside')).toHaveTextContent('1 – 7 tháng 11');
  });
});

describe('Bento first-paint motion (F35.8)', () => {
  let mock: FetchMock;
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    ({ mock } = await setUpBento());
    mock.on('GET /api/today', { body: denseView() });
  });
  afterEach(() => {
    restoreWindow();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const animated = () => ({
    strip: strip().classList.contains('is-intro'),
    rings: document.querySelector('.today-rings')?.classList.contains('is-intro'),
    bars: document.querySelector('.today-bars')?.classList.contains('is-intro'),
  });

  it('(F35.8) bars, rings and writing bars animate once on the first paint with data, left → right', async () => {
    restoreWindow = stubWindow(1280);
    const first = render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(animated()).toEqual({ strip: true, rings: true, bars: true });
    expect(overdueCell().style.getPropertyValue('--today-cell-index')).toBe('0');
    expect(busyCell().style.getPropertyValue('--today-cell-index')).toBe('4');
    // A refresh of the data keeps whatever is playing; it never starts it again.
    act(() => emitServerEvent({ type: 'resync' }));
    first.unmount();
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(animated()).toEqual({ strip: false, rings: false, bars: false });
  });

  it('(F35.8) the intro classes go once played, so later rings never animate', async () => {
    restoreWindow = stubWindow(1280);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render(<TodayScreen />);
    await vi.waitFor(() => expect(document.querySelector('.today-rings')).not.toBeNull());
    expect(animated().rings).toBe(true);
    act(() => vi.advanceTimersByTime(700));
    expect(animated()).toMatchObject({ rings: false, bars: false });
  });

  it('(F35.8) reduced motion: the final state at once, no animation classes', async () => {
    restoreWindow = stubWindow(1280, true);
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    expect(animated()).toEqual({ strip: false, rings: false, bars: false });
  });
});
