import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isoAddDays, isoMonth, subscribeLocalDay, todayIso, useLocalDay } from './local-day';

function DayProbe() {
  return <p>{useLocalDay()}</p>;
}

describe('local day', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats today and does calendar arithmetic across month and year ends', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59));
    expect(todayIso()).toBe('2026-10-19');
    expect(isoAddDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(isoAddDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isoAddDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(isoAddDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(isoMonth('2026-10-19')).toBe('2026-10');
    expect(() => isoAddDays('2026-02-30', 1)).toThrow(RangeError);
  });

  it('re-renders at local midnight (23:59 → 00:00)', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 23, 59, 0));
    render(<DayProbe />);
    expect(screen.getByText('2026-10-19')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(61_000));
    expect(screen.getByText('2026-10-20')).toBeInTheDocument();
  });

  it('notices a day change on focus and on visibilitychange (wake after sleep)', () => {
    vi.setSystemTime(new Date(2026, 9, 19, 22, 0));
    const seen: string[] = [];
    const stop = subscribeLocalDay((day) => seen.push(day));
    // The machine slept: the clock jumps without the midnight timer having fired.
    vi.setSystemTime(new Date(2026, 9, 21, 7, 0));
    window.dispatchEvent(new Event('focus'));
    vi.setSystemTime(new Date(2026, 9, 22, 7, 0));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    stop();
    expect(seen).toEqual(['2026-10-21', '2026-10-22']);
  });
});
