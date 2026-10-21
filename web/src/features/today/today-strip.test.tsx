import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoAddDays } from '../../lib/local-day';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { DEFAULT_UI_PREFS, type FontSize } from '../../lib/ui-prefs';
import { resetStripIntro } from './strip-intro';
import { TodayStrip } from './today-strip';
import {
  longTitle,
  stubStripWidth,
  stubWindow,
  taskItem,
  TODAY,
  todayView,
} from './today-test-fixtures';

const BUSY_DAY = '2026-10-23'; // a Friday

function denseView() {
  const busy = Array.from({ length: 10 }, (_, i) =>
    taskItem(longTitle(`Việc ${String(i).padStart(2, '0')}`), BUSY_DAY),
  );
  const overdue = Array.from({ length: 30 }, (_, i) =>
    taskItem(longTitle(`Trễ ${String(i).padStart(2, '0')}`), isoAddDays(TODAY, -1 - (i % 5))),
  );
  return todayView({ days: { [BUSY_DAY]: busy }, overdue });
}

function renderStrip(view = denseView()) {
  const onItemDone = vi.fn();
  const utils = render(<TodayStrip view={view} onItemDone={onItemDone} refresh={vi.fn()} />);
  return { ...utils, onItemDone };
}

const busyCell = () => screen.getByRole('button', { name: 'Thứ sáu, 23 tháng 10: 10 việc' });
const overdueCell = () => screen.getByRole('button', { name: 'Quá hạn: 30 việc' });

describe('14-day strip with dense data (F10.2)', () => {
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    await resetAppState();
    installFetchMock();
    resetStripIntro();
    restoreWindow = stubWindow(1280);
    useUiPrefsStore.getState().setPrefs(DEFAULT_UI_PREFS);
  });
  afterEach(() => {
    restoreWindow();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a busy day shows two one-line labels and "+8"; the overdue cell shows', () => {
    renderStrip();
    expect(overdueCell()).toHaveTextContent('Quá hạn (30)');
    expect(busyCell()).toHaveTextContent('+8');
    const labels = busyCell().querySelectorAll<HTMLElement>('.today-strip__label');
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.textContent).toHaveLength(120);
      // One tooltip only: the strip's own (no native `title` on top of it).
      expect(label).not.toHaveAttribute('title');
      expect(label.style.getPropertyValue('--today-label-lines')).toBe('1');
    }
    // Every cell reserves the same label block, so a busy day is never taller than a free one.
    const cells = screen.getAllByRole('button');
    expect(cells).toHaveLength(61);
    for (const cell of cells) expect(cell.querySelectorAll('.today-strip__labels')).toHaveLength(1);
  });

  it('a lone label may wrap over the three reserved lines; two labels share them (like the mock)', () => {
    const one = taskItem('Nộp BT1 Giải tích', '2026-10-21');
    const [a, b] = ['Thi giữa kỳ Xác suất', 'Ôn tập chương 3'].map((title) =>
      taskItem(title, '2026-10-22'),
    );
    renderStrip(todayView({ days: { '2026-10-21': [one], '2026-10-22': [a!, b!] } }));
    const lines = (name: string) =>
      [
        ...screen
          .getByRole('button', { name })
          .querySelectorAll<HTMLElement>('.today-strip__label'),
      ].map((label) => label.style.getPropertyValue('--today-label-lines'));
    expect(lines('Thứ tư, 21 tháng 10: 1 việc')).toEqual(['3']);
    expect(lines('Thứ năm, 22 tháng 10: 2 việc')).toEqual(['2', '1']);
  });

  it('the caption names the visible range with its months once the strip is scrolled', () => {
    renderStrip();
    expect(screen.getByRole('group', { name: 'Các ngày tới' })).toBeInTheDocument();
    const caption = document.querySelector('.today-strip__caption');
    expect(caption).toHaveTextContent('14 ngày tới');
    const scroller = document.querySelector('.today-strip__scroller') as HTMLElement;
    Object.defineProperty(scroller, 'scrollWidth', { configurable: true, value: 6000 });
    // 100 px per day: the 46th day (4 Dec) first, 14 days visible.
    scroller.scrollLeft = 4500;
    fireEvent.scroll(scroller);
    expect(caption).toHaveTextContent('4 – 17 tháng 12');
    scroller.scrollLeft = 1200; // 1 Nov … 14 Nov
    fireEvent.scroll(scroller);
    expect(caption).toHaveTextContent('1 – 14 tháng 11');
    scroller.scrollLeft = 1000; // 30 Oct … 12 Nov: both months
    fireEvent.scroll(scroller);
    expect(caption).toHaveTextContent('30 tháng 10 – 12 tháng 11');
    scroller.scrollLeft = 0;
    fireEvent.scroll(scroller);
    expect(caption).toHaveTextContent('14 ngày tới');
  });

  it('the popover lists all 10 items of the day and all 30 overdue items', async () => {
    const user = userEvent.setup();
    renderStrip();
    await user.click(busyCell());
    const day = screen.getByRole('dialog', { name: 'Thứ sáu, 23 tháng 10' });
    expect(within(day).getAllByRole('checkbox')).toHaveLength(10);
    expect(busyCell()).toHaveAttribute('aria-expanded', 'true');
    await user.click(overdueCell());
    const overdue = screen.getByRole('dialog', { name: 'Quá hạn (30)' });
    expect(within(overdue).getAllByRole('checkbox')).toHaveLength(30);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  const visibleDays = (container: HTMLElement) => {
    const strip = container.querySelector<HTMLElement>('.today-strip');
    expect(strip?.style.getPropertyValue('--today-strip-days')).toBe(
      strip?.getAttribute('data-visible-days'),
    );
    expect(container.querySelectorAll('.today-strip__scroller .today-strip__cell')).toHaveLength(
      60,
    );
    return Number(strip?.getAttribute('data-visible-days'));
  };

  it.each([
    // [window, strip width it gets, font size, days]
    [360, 328, 16, 7],
    [720, 688, 16, 7], // the content column spans the window
    [800, 720, 16, 14],
    [900, 576, 16, 7], // the sidebar takes 260 px: 14 days would get about 36 px each
    [1000, 676, 16, 7],
    [1280, 720, 16, 14], // the content column's 720 px cap
    [1280, 720, 14, 14],
    [1280, 720, 18, 7], // bigger text: 14 days would cut every label
  ])(
    'a %i px window whose strip gets %i px at a %i px font shows %i days, the rest scroll',
    (windowWidth, width, fontSize, days) => {
      restoreWindow();
      restoreWindow = stubWindow(windowWidth);
      useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, fontSize: fontSize as FontSize });
      stubStripWidth(width);
      const { container } = renderStrip();
      expect(visibleDays(container)).toBe(days);
    },
  );

  it('follows the width the strip gets while it changes, and the base font size', () => {
    const layout = stubStripWidth(720);
    const { container } = renderStrip();
    expect(visibleDays(container)).toBe(14);
    // The window narrows until the sidebar squeezes the content column.
    act(() => layout.resize(640));
    expect(visibleDays(container)).toBe(7);
    act(() => layout.resize(720));
    expect(visibleDays(container)).toBe(14);
    act(() => useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, fontSize: 18 }));
    expect(visibleDays(container)).toBe(7);
  });

  it.each([
    [719, 7],
    [720, 14],
  ])('without layout a %i px window shows %i days (the window rule)', (width, days) => {
    restoreWindow();
    restoreWindow = stubWindow(width);
    const { container } = renderStrip();
    expect(visibleDays(container)).toBe(days);
  });

  it('hover or focus shows the full titles (five, then "+n"); Esc hides them', () => {
    renderStrip();
    act(() => busyCell().focus());
    const tooltip = document.querySelector('.today-strip__tooltip');
    expect(tooltip?.querySelectorAll('.today-strip__tooltip-line')).toHaveLength(5);
    expect(tooltip).toHaveTextContent('+5');
    fireEvent.keyDown(busyCell(), { key: 'Escape' });
    expect(document.querySelector('.today-strip__tooltip')).toBeNull();
    fireEvent.mouseEnter(overdueCell());
    expect(document.querySelector('.today-strip__tooltip')).not.toBeNull();
  });

  it('the line draws once per app start, never under reduced motion', () => {
    const first = renderStrip();
    expect(first.container.querySelector('.today-strip')).toHaveClass('is-intro');
    first.unmount();
    const again = renderStrip();
    expect(again.container.querySelector('.today-strip')).not.toHaveClass('is-intro');
    again.unmount();
    resetStripIntro();
    restoreWindow();
    restoreWindow = stubWindow(1280, true);
    const calm = renderStrip();
    expect(calm.container.querySelector('.today-strip')).not.toHaveClass('is-intro');
  });

  it('a popover short enough not to scroll does not clip the row tooltips; a long one does', async () => {
    const user = userEvent.setup();
    const heights = (scroll: number, client: number) => {
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scroll);
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(client);
    };
    heights(900, 420); // 10 rows: the popover scrolls
    renderStrip();
    await user.click(busyCell());
    expect(screen.getByRole('dialog')).not.toHaveClass('is-fitting');
    await user.keyboard('{Escape}');
    vi.restoreAllMocks();
    heights(180, 180);
    await user.click(busyCell());
    expect(screen.getByRole('dialog')).toHaveClass('is-fitting');
  });

  it('a click outside closes the popover without moving focus', async () => {
    const user = userEvent.setup();
    renderStrip();
    await user.click(busyCell());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
