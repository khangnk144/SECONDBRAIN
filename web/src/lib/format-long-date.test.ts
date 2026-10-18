import { describe, expect, it } from 'vitest';
import { formatLongDate } from './format-long-date';

describe('formatLongDate', () => {
  const sunday = new Date(2026, 9, 18, 19, 45);

  it('formats Vietnamese dates with a capitalized weekday', () => {
    expect(formatLongDate(sunday, 'vi', 'dddd, D [tháng] M')).toBe('Chủ nhật, 18 tháng 10');
  });

  it('formats English dates', () => {
    expect(formatLongDate(sunday, 'en', 'dddd, MMMM D')).toBe('Sunday, October 18');
  });
});
