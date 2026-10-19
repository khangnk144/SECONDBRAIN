import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeadlineService } from '../../src/index/deadline-service.js';
import type { DeadlineService } from '../../src/index/index-types.js';
import { createIndexedVault, makeClock, type IndexedVault } from './helpers/index-test-vault.js';

// Local wall-clock times (new Date(y, monthIndex, d, h, m)); the container runs in UTC+7, where
// 00:30 local is still the previous day in UTC, so any UTC slip shows up as a wrong date.
const clock = makeClock(new Date(2026, 9, 21, 23, 59));

const FILES = {
  '1 Projects/Mốc.md': [
    '- [ ] Ngày mai 📅 2026-10-22',
    '- [ ] Đầu tháng 📅 2026-11-01',
    '- [ ] Năm mới 📅 2027-01-01',
    '',
  ].join('\n'),
};

let v: IndexedVault;
let service: DeadlineService;
beforeAll(async () => {
  v = await createIndexedVault({ files: FILES, now: clock.now });
  service = createDeadlineService(v.index, clock.now);
});
afterAll(() => v.cleanup());

const item = (title: string) => {
  const found = service.items().find((i) => i.title === title);
  if (!found) throw new Error(`missing ${title}`);
  return { daysLeft: found.daysLeft, urgency: found.urgency };
};

describe('urgency follows local calendar days with a mocked clock (F9.3)', () => {
  it('flips at local midnight, not at UTC midnight', () => {
    clock.set(new Date(2026, 9, 21, 23, 59));
    expect(service.today().date).toBe('2026-10-21');
    expect(item('Ngày mai')).toEqual({ daysLeft: 1, urgency: 'urgent' });
    clock.set(new Date(2026, 9, 22, 0, 0));
    expect(service.today().date).toBe('2026-10-22');
    expect(item('Ngày mai')).toEqual({ daysLeft: 0, urgency: 'urgent' });
    expect(service.today().todayTasks.map((t) => t.title)).toEqual(['Ngày mai']);
    clock.set(new Date(2026, 9, 22, 0, 30));
    expect(service.today().date).toBe('2026-10-22');
  });

  it('crosses a month boundary', () => {
    clock.set(new Date(2026, 9, 31, 23, 59));
    expect(item('Đầu tháng')).toEqual({ daysLeft: 1, urgency: 'urgent' });
    clock.set(new Date(2026, 10, 1, 0, 0));
    expect(item('Đầu tháng')).toEqual({ daysLeft: 0, urgency: 'urgent' });
    expect(
      service
        .calendar('2026-11')
        .days.find((d) => d.date === '2026-11-01')
        ?.items.map((i) => i.title),
    ).toEqual(['Đầu tháng']);
  });

  it('crosses a year boundary, with every urgency threshold', () => {
    const at = (y: number, m: number, d: number) => {
      clock.set(new Date(y, m, d, 12, 0));
      return item('Năm mới');
    };
    expect(at(2026, 11, 23)).toEqual({ daysLeft: 9, urgency: 'ok' });
    expect(at(2026, 11, 24)).toEqual({ daysLeft: 8, urgency: 'ok' });
    expect(at(2026, 11, 25)).toEqual({ daysLeft: 7, urgency: 'soon' });
    expect(at(2026, 11, 29)).toEqual({ daysLeft: 3, urgency: 'soon' });
    expect(at(2026, 11, 30)).toEqual({ daysLeft: 2, urgency: 'urgent' });
    clock.set(new Date(2026, 11, 31, 23, 59));
    expect(item('Năm mới')).toEqual({ daysLeft: 1, urgency: 'urgent' });
    clock.set(new Date(2027, 0, 1, 0, 0));
    expect(item('Năm mới')).toEqual({ daysLeft: 0, urgency: 'urgent' });
    expect(at(2027, 0, 2)).toEqual({ daysLeft: -1, urgency: 'urgent' });
  });

  it('the same service instance is right after the machine sleeps for days (no reindex)', () => {
    clock.set(new Date(2026, 9, 21, 22, 0));
    const before = service.today();
    expect(before.summary.overdue).toBe(0);
    expect(before.strip.days[0]?.date).toBe('2026-10-21');
    // The laptop sleeps; nothing is reindexed; the clock now reads ten days later.
    clock.set(new Date(2026, 9, 31, 8, 0));
    const after = service.today();
    expect(after.date).toBe('2026-10-31');
    expect(after.strip.days[0]?.date).toBe('2026-10-31');
    expect(after.strip.overdue.map((i) => i.title)).toEqual(['Ngày mai']);
    expect(after.summary.overdue).toBe(1);
    expect(service.tasks().overdue.map((t) => t.title)).toEqual(['Ngày mai']);
    expect(service.tasks().next7.map((t) => t.title)).toEqual(['Đầu tháng']);
  });
});
