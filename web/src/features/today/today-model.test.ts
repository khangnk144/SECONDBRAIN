import { describe, expect, it } from 'vitest';
import { keepItem, NO_KEPT_ITEMS, withKeptItems } from './today-kept-items';
import { applyItemDone, withoutProject } from './today-optimistic';
import { buildStrip, nextStripKey, OVERDUE_KEY, popoverItems } from './today-strip-model';
import { project, taskEntry, taskItem, TODAY, todayView } from './today-test-fixtures';

describe('strip model (F10.2)', () => {
  it('two labels by urgency then title, "+n" for the rest, dot by the most urgent', () => {
    const items = ['Đọc', 'Ân', 'Bài', 'Chép'].map((title) => taskItem(title, '2026-10-22'));
    const later = taskItem('Nộp nháp', '2026-11-05');
    const strip = buildStrip(todayView({ days: { '2026-10-22': items, '2026-11-05': [later] } }));
    const busy = strip.days[2]!;
    expect(busy.labels.map((item) => item.title)).toEqual(['Ân', 'Bài']);
    expect(busy.more).toBe(2);
    expect(busy.urgency).toBe('urgent');
    expect(strip.days.find((day) => day.key === '2026-11-05')?.urgency).toBe('ok');
    expect(strip.days[0]).toMatchObject({ isToday: true, urgency: null, more: 0 });
    expect(strip.days).toHaveLength(60);
  });

  it('the overdue cell exists only with open overdue items; done items never show', () => {
    const late = taskItem('Bài cũ', '2026-10-18');
    expect(buildStrip(todayView()).overdue).toBeNull();
    expect(buildStrip(todayView({ overdue: [late] })).overdue?.items).toHaveLength(1);
    const ticked = todayView({ overdue: [{ ...late, done: true }] });
    expect(buildStrip(ticked).overdue).toBeNull();
    expect(buildStrip(ticked, true).overdue?.items).toEqual([]); // kept while its popover is open
    expect(popoverItems(ticked, OVERDUE_KEY)).toHaveLength(1);
  });

  it('arrow keys, Home and End move along the keys and stop at the ends', () => {
    const keys = [OVERDUE_KEY, '2026-10-20', '2026-10-21', '2026-10-22'];
    expect(nextStripKey(keys, '2026-10-20', 'ArrowLeft')).toBe(OVERDUE_KEY);
    expect(nextStripKey(keys, OVERDUE_KEY, 'ArrowLeft')).toBe(OVERDUE_KEY);
    expect(nextStripKey(keys, '2026-10-22', 'ArrowRight')).toBe('2026-10-22');
    expect(nextStripKey(keys, '2026-10-21', 'Home')).toBe(OVERDUE_KEY);
    expect(nextStripKey(keys, '2026-10-21', 'End')).toBe('2026-10-22');
    expect(nextStripKey(keys, '2026-10-21', 'ArrowUp')).toBeNull();
  });
});

describe('optimistic Today update (F10.4)', () => {
  const dueToday = taskItem('Làm BT1', TODAY);
  const late = taskItem('Bài cũ', '2026-10-19');
  const view = todayView({
    days: { [TODAY]: [dueToday] },
    overdue: [late],
    todayTasks: [taskEntry(late), taskEntry(dueToday)],
    // As the server counts: the overdue task only as overdue, the week and today from today on.
    summary: { overdue: 1, deadlinesThisWeek: 1, openToday: 1 },
    projects: [project()],
  });

  it('ticking an overdue task moves only the overdue count, once, and flags it done everywhere', () => {
    const next = applyItemDone(view, late.id, true);
    expect(next.summary).toEqual({ overdue: 0, deadlinesThisWeek: 1, openToday: 1 });
    expect(next.strip.overdue[0]?.done).toBe(true);
    expect(next.todayTasks.find((task) => task.id === late.id)?.done).toBe(true);
    expect(applyItemDone(next, late.id, true).summary).toEqual(next.summary);
  });

  it('unticking gives the counts back; a project marked done leaves the list', () => {
    const ticked = applyItemDone(view, dueToday.id, true);
    expect(ticked.summary).toEqual({ overdue: 1, deadlinesThisWeek: 0, openToday: 0 });
    expect(applyItemDone(ticked, dueToday.id, false).summary).toEqual(view.summary);
    expect(withoutProject(view, project().path).projects).toEqual([]);
  });
});

describe('rows ticked during the visit', () => {
  const [a, b, c] = ['Đọc', 'Ôn', 'Nộp'].map((title) => taskItem(title, TODAY));
  const view = todayView({
    days: { [TODAY]: [a!, b!, c!] },
    todayTasks: [a!, b!, c!].map(taskEntry),
  });

  it('come back where they were, ticked ones only, and only on the same day', () => {
    // B then A are ticked; the fresh view lists C alone.
    let kept = keepItem(NO_KEPT_ITEMS, view, b!.id, true);
    kept = keepItem(kept, withKeptItems(view, kept), a!.id, true);
    const fresh = todayView({ days: { [TODAY]: [c!] }, todayTasks: [taskEntry(c!)] });
    const shown = withKeptItems(fresh, kept);
    expect(shown.todayTasks.map((task) => [task.title, task.done])).toEqual([
      ['Đọc', true],
      ['Ôn', true],
      ['Nộp', false],
    ]);
    expect(shown.strip.days[0]?.items.map((item) => item.id).sort()).toEqual(
      [a!.id, b!.id, c!.id].sort(),
    );
    expect(buildStrip(shown).days[0]?.items).toHaveLength(1); // the strip still hides done ones
    expect(shown.summary).toEqual(fresh.summary);

    // Unticked again: the server lists it itself (open), the kept copy is not added twice.
    kept = keepItem(kept, shown, a!.id, false);
    expect(withKeptItems(fresh, kept).todayTasks.map((task) => task.title)).toEqual([
      'Nộp',
      'Ôn', // the row it followed is not listed: it goes last
    ]);
    const reopened = todayView({ todayTasks: [a!, c!].map(taskEntry) });
    expect(withKeptItems(reopened, kept).todayTasks.map((task) => [task.title, task.done])).toEqual(
      [
        ['Đọc', false],
        ['Ôn', true],
        ['Nộp', false],
      ],
    );
    expect(withKeptItems({ ...fresh, date: '2026-10-21' }, kept).todayTasks).toHaveLength(1);
  });
});
