import { describe, expect, it } from 'vitest';
import {
  calendarSearchParams,
  defaultActiveDay,
  monthGridDates,
  monthGridRange,
  moveDayByKey,
  moveItemInView,
  readCalendarParams,
  sameDayInMonth,
  shiftMonth,
  visibleItems,
} from './calendar-month-model';
import {
  doneTask,
  octoberView,
  projectDeadline,
  quiz,
  readPaper,
  submitDraft,
} from './__tests__/calendar-fixtures';

describe('calendar month model (F11.1)', () => {
  it('weeks run Monday to Sunday and cover the whole month with neighbouring days', () => {
    const october = monthGridDates('2026-10');
    expect(october).toHaveLength(5);
    expect(october[0]?.[0]).toBe('2026-09-28');
    expect(october[4]?.[6]).toBe('2026-11-01');
    // A month starting on Monday and ending on Sunday needs no neighbours at all.
    expect(monthGridRange('2027-02')).toEqual({ start: '2027-02-01', end: '2027-02-28' });
    expect(monthGridDates('2026-03')).toHaveLength(6);
  });

  it('URL state: valid month and day kept, broken values fall back sensibly', () => {
    const read = (search: string) => readCalendarParams(new URLSearchParams(search), '2026-10-20');
    expect(read('month=2026-11&day=2026-11-05')).toEqual({ month: '2026-11', day: '2026-11-05' });
    expect(read('')).toEqual({ month: '2026-10', day: null });
    expect(read('day=2027-01-09')).toEqual({ month: '2027-01', day: '2027-01-09' });
    expect(read('month=2026-13&day=2026-02-30')).toEqual({ month: '2026-10', day: null });
    expect(calendarSearchParams({ month: '2026-12', day: null }).toString()).toBe('month=2026-12');
    expect(calendarSearchParams({ month: '2026-12', day: '2026-12-24' }).toString()).toBe(
      'month=2026-12&day=2026-12-24',
    );
  });

  it('month steps and the same day in another month, clamped to its length', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(sameDayInMonth('2026-10-31', '2026-11')).toBe('2026-11-30');
    expect(sameDayInMonth('2028-01-31', '2028-02')).toBe('2028-02-29');
    expect(sameDayInMonth('2026-10-05', '2027-03')).toBe('2027-03-05');
  });

  it('keys: arrows by day/week across months, Home/End to Monday/Sunday, PageUp/PageDown', () => {
    expect(moveDayByKey('2026-10-31', 'ArrowRight')).toBe('2026-11-01');
    expect(moveDayByKey('2026-10-01', 'ArrowUp')).toBe('2026-09-24');
    expect(moveDayByKey('2026-10-20', 'Home')).toBe('2026-10-19');
    expect(moveDayByKey('2026-10-20', 'End')).toBe('2026-10-25');
    expect(moveDayByKey('2026-10-31', 'PageDown')).toBe('2026-11-30');
    expect(moveDayByKey('2026-03-31', 'PageUp')).toBe('2026-02-28');
    expect(moveDayByKey('2026-10-20', 'a')).toBeNull();
  });

  it('the tab stop starts on the opened day, else today, else the 1st', () => {
    expect(defaultActiveDay('2026-10', '2026-10-05', '2026-10-20')).toBe('2026-10-05');
    expect(defaultActiveDay('2026-10', '2026-11-05', '2026-10-20')).toBe('2026-10-20');
    expect(defaultActiveDay('2026-10', '2026-11-01', '2026-10-20')).toBe('2026-11-01');
    expect(defaultActiveDay('2026-12', null, '2026-10-20')).toBe('2026-12-01');
  });

  it('three items per cell, then the rest counted', () => {
    const four = [submitDraft, doneTask, projectDeadline, readPaper];
    expect(visibleItems(four)).toEqual({ shown: four.slice(0, 3), more: 1 });
    expect(visibleItems([quiz])).toEqual({ shown: [quiz], more: 0 });
  });

  it('an optimistic move takes the item off its day and onto the new one with fresh urgency', () => {
    const view = octoberView(false);
    const moved = moveItemInView(view, submitDraft.id, '2026-10-30', '2026-10-20');
    const day = (date: string) => moved.days.find((d) => d.date === date)?.items ?? [];
    expect(day('2026-10-20').map((i) => i.id)).toEqual([
      doneTask.id,
      projectDeadline.id,
      readPaper.id,
    ]);
    expect(day('2026-10-30')).toEqual([
      expect.objectContaining({
        id: submitDraft.id,
        date: '2026-10-30',
        daysLeft: 10,
        urgency: 'ok',
      }),
    ]);
    // Untouched days keep their identity (cells that did not change are not redrawn).
    expect(moved.days.find((d) => d.date === '2026-10-23')).toBe(
      view.days.find((d) => d.date === '2026-10-23'),
    );
    expect(moveItemInView(view, 'task:missing#1', '2026-10-30', '2026-10-20')).toBe(view);
  });
});
