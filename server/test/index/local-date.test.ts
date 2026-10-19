import { describe, expect, it } from 'vitest';
import {
  addDays,
  dateRange,
  diffDays,
  endOfWeekSunday,
  isCalendarDate,
  isoWeekday,
  localMidnight,
  monthBounds,
  parseCalendarDate,
  parseMonth,
  startOfWeekMonday,
  toLocalDate,
} from '../../src/lib/local-date.js';

describe('local calendar dates', () => {
  it('takes the date from the local wall clock, not from the UTC instant', () => {
    // 00:30 local is still the previous day in UTC for any zone east of Greenwich (and the
    // reverse west of it); the local date must win either way.
    expect(toLocalDate(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toLocalDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31');
  });

  it('validates real calendar dates only', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true);
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-02-30')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
    expect(isCalendarDate(20261018)).toBe(false);
    // The same year range as the Markdown layer's validator: four digits, 1000–9999.
    expect(isCalendarDate('1000-01-01')).toBe(true);
    expect(isCalendarDate('9999-12-31')).toBe(true);
    expect(isCalendarDate('0999-12-31')).toBe(false);
    expect(isCalendarDate('0000-01-01')).toBe(false);
    expect(isCalendarDate('10000-01-01')).toBe(false);
    expect(parseMonth('0999-01')).toBeNull();
    expect(parseCalendarDate('2026-10-18')).toEqual({ year: 2026, month: 10, day: 18 });
    expect(parseMonth('2026-10')).toEqual({ year: 2026, month: 10 });
    expect(parseMonth('2026-00')).toBeNull();
  });

  it('adds and subtracts days across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(diffDays('2026-12-30', '2027-01-02')).toBe(3);
    expect(diffDays('2026-10-18', '2026-10-11')).toBe(-7);
  });

  it('counts whole days across a daylight-saving change', () => {
    // Calendar arithmetic never goes through instants, so a 23- or 25-hour day is still one day.
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-24', '2026-10-26')).toBe(2);
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
  });

  it('finds the Monday–Sunday week of a date', () => {
    expect(isoWeekday('2026-10-18')).toBe(7);
    expect(startOfWeekMonday('2026-10-18')).toBe('2026-10-12');
    expect(endOfWeekSunday('2026-10-18')).toBe('2026-10-18');
    expect(startOfWeekMonday('2026-10-19')).toBe('2026-10-19');
    expect(startOfWeekMonday('2027-01-01')).toBe('2026-12-28');
    expect(endOfWeekSunday('2026-12-30')).toBe('2027-01-03');
  });

  it('lists ranges and month bounds', () => {
    expect(dateRange('2026-12-30', '2027-01-02')).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29' });
    expect(() => monthBounds('2026-1')).toThrow(RangeError);
  });

  it('turns a calendar date into local midnight', () => {
    const midnight = localMidnight('2026-10-18');
    expect([midnight.getFullYear(), midnight.getMonth(), midnight.getDate()]).toEqual([
      2026, 9, 18,
    ]);
    expect([midnight.getHours(), midnight.getMinutes()]).toEqual([0, 0]);
  });
});
