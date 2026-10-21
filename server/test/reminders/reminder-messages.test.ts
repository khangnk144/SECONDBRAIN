import { describe, expect, it } from 'vitest';
import {
  formatDueDate,
  noteDeepLink,
  reminderToast,
  summaryToast,
  toastTitleText,
} from '../../src/reminders/reminder-messages.js';

const PATH = '1 Projects/Đồ án Giải tích.md';
const base = { title: 'Đồ án Giải tích', path: PATH, due: '2026-10-24', overdue: false };

describe('toast texts in the UI language (F17, F19)', () => {
  it('Vietnamese titles per threshold, the overdue catch-up, and the body with dd/MM/yyyy', () => {
    const vi = (threshold: 3 | 1 | 0, overdue = false) =>
      reminderToast({ ...base, threshold, overdue }, 'vi', 4747).title;
    expect(vi(3)).toBe('Còn 3 ngày: Đồ án Giải tích');
    expect(vi(1)).toBe('Còn 1 ngày: Đồ án Giải tích');
    expect(vi(0)).toBe('Hôm nay đến hạn: Đồ án Giải tích');
    expect(vi(0, true)).toBe('Đã quá hạn: Đồ án Giải tích');
    expect(reminderToast({ ...base, threshold: 3 }, 'vi', 4747).body).toBe(
      'Hạn chót 24/10/2026. Bấm để mở ghi chú.',
    );
  });

  it('English titles and the body with "d MMMM yyyy"', () => {
    const en = (threshold: 3 | 1 | 0, overdue = false) =>
      reminderToast({ ...base, threshold, overdue, due: '2026-11-03' }, 'en', 4747);
    expect(en(3).title).toBe('3 days left: Đồ án Giải tích');
    expect(en(1).title).toBe('1 day left: Đồ án Giải tích');
    expect(en(0).title).toBe('Due today: Đồ án Giải tích');
    expect(en(0, true).title).toBe('Overdue: Đồ án Giải tích');
    expect(en(3).body).toBe('Due 3 November 2026. Click to open the note.');
    expect(formatDueDate('2026-01-05', 'vi')).toBe('05/01/2026');
    expect(formatDueDate('2026-01-05', 'en')).toBe('5 January 2026');
  });

  it('the summary toast of a burst opens Today', () => {
    expect(summaryToast(5, 'vi', 4747)).toEqual({
      title: 'Bạn có 5 deadline sắp tới',
      body: 'Bấm để xem trang Hôm nay.',
      link: 'http://localhost:4747/#/',
    });
    expect(summaryToast(4, 'en', 4800)).toEqual({
      title: 'You have 4 upcoming deadlines',
      body: 'Click to open Today.',
      link: 'http://localhost:4800/#/',
    });
  });

  it('deep link: the note route on the configured port with the path percent-encoded (NFC)', () => {
    const link =
      'http://localhost:4747/#/note?path=1%20Projects%2F%C4%90%E1%BB%93%20%C3%A1n%20Gi%E1%BA%A3i%20t%C3%ADch.md';
    expect(noteDeepLink(4747, PATH)).toBe(link);
    expect(noteDeepLink(4747, PATH.normalize('NFD'))).toBe(link);
    expect(reminderToast({ ...base, threshold: 1 }, 'vi', 4747).link).toBe(link);
    expect(decodeURIComponent(new URL(link).hash.split('path=')[1]!)).toBe(PATH);
  });

  it('titles are NFC, single-line and cut at 120 characters with "…"', () => {
    expect(toastTitleText('Đồ án Giải tích'.normalize('NFD'))).toBe('Đồ án Giải tích');
    expect(toastTitleText('  Hai\ndòng\t ')).toBe('Hai dòng');
    const long = 'Đ'.repeat(130);
    const cut = toastTitleText(long);
    expect(Array.from(cut)).toHaveLength(120);
    expect(cut.endsWith('Đ…')).toBe(true);
    expect(toastTitleText('ằ'.repeat(120))).toBe('ằ'.repeat(120));
    const title = reminderToast({ ...base, title: long, threshold: 3 }, 'vi', 4747).title;
    expect(title).toBe(`Còn 3 ngày: ${cut}`);
  });
});
