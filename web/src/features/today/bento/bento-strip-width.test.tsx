import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../../../lib/testing/fetch-mock';
import { resetAppState } from '../../../lib/testing/reset-app-state';
import { useUiPrefsStore } from '../../../lib/ui-prefs-store';
import { DEFAULT_UI_PREFS, type FontSize } from '../../../lib/ui-prefs';
import { resetStripIntro } from '../strip-intro';
import { TodayStrip } from '../today-strip';
import { stubStripWidth, stubWindow, taskItem, TODAY, todayView } from '../today-test-fixtures';
import { bentoVisibleDays, visibleDaysForWidth } from '../use-strip-visible-days';

describe('Bento strip: as many whole days as fit at ≥ 66 px (FIX-B B3, D1)', () => {
  it.each([
    // [scroller width, font size, days]
    [1240, 16, 14], // 1440 window: 14 cells of ~82 px
    [1030, 16, 14], // 14 × 66 + 13 × 8 = 1028: just fits
    [1000, 16, 13], // 1100 window
    [900, 16, 12], // 1024 window
    [780, 16, 10], // 960 window (half a 1920 screen)
    [600, 16, 8],
    [300, 16, 4],
    [206, 16, 2], // 360 phone with the overdue cell
    [40, 16, 1], // never zero
    [900, 18, 11], // 74.25 px minimum at 18 px
    [900, 14, 12], // the 66 px floor holds at 14 px
  ])('a %i px scroller at %i px font shows %i days', (width, font, days) => {
    expect(bentoVisibleDays(width, font)).toBe(days);
    // Each visible cell gets at least 66 px (and 4.125rem).
    const cell = (width - (days - 1) * 8) / days;
    if (days > 1) expect(cell).toBeGreaterThanOrEqual(Math.max(66, 4.125 * font));
  });

  it('calm keeps SPEC F10: 14 from 44rem, else 7', () => {
    expect(visibleDaysForWidth(704, 16)).toBe(14);
    expect(visibleDaysForWidth(703, 16)).toBe(7);
    expect(visibleDaysForWidth(360, 16)).toBe(7);
  });
});

describe('Bento strip in the DOM', () => {
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

  const view = () =>
    todayView({ overdue: [taskItem('Trễ hạn', '2026-10-20')], days: { [TODAY]: [] } });
  const visible = (container: HTMLElement) => {
    const strip = container.querySelector<HTMLElement>('.today-strip')!;
    expect(strip.style.getPropertyValue('--today-strip-days')).toBe(
      strip.getAttribute('data-visible-days'),
    );
    return Number(strip.getAttribute('data-visible-days'));
  };

  it('measures the scroller (the overdue cell stays outside it) and follows resizes', () => {
    // 960 px window: the tile's content is about 860 px, the overdue cell takes 80 px.
    const layout = stubStripWidth(860, 80);
    const { container } = render(
      <TodayStrip view={view()} onItemDone={vi.fn()} refresh={vi.fn()} variant="bento" />,
    );
    expect(visible(container)).toBe(10);
    act(() => layout.resize(1320));
    expect(visible(container)).toBe(14);
    act(() => layout.resize(286)); // 360 px phone
    expect(visible(container)).toBe(2);
  });

  it.each([14, 16, 18])('a bigger font shows fewer, wider days (%i px)', (font) => {
    useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, fontSize: font as FontSize });
    stubStripWidth(980, 80);
    const { container } = render(
      <TodayStrip view={view()} onItemDone={vi.fn()} refresh={vi.fn()} variant="bento" />,
    );
    expect(visible(container)).toBe(bentoVisibleDays(900, font));
  });

  it('the calm strip still measures the whole strip (7 below 44rem)', () => {
    stubStripWidth(680, 80);
    const { container } = render(
      <TodayStrip view={view()} onItemDone={vi.fn()} refresh={vi.fn()} />,
    );
    expect(visible(container)).toBe(7);
  });
});
