import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeadlineService } from '../../src/index/deadline-service.js';
import type { DeadlineService } from '../../src/index/index-types.js';
import {
  FIXTURE_FILES as FILES,
  FIXTURE_NOW,
  FIXTURE_PROJECT as P,
  FIXTURE_TODAY as today,
  QUIET_FILES,
  sortedIds as ids,
  visibleItems as visible,
} from './helpers/content-class-expectations.js';
import { createIndexedVault, makeClock, type IndexedVault } from './helpers/index-test-vault.js';

const clock = makeClock(FIXTURE_NOW);

let v: IndexedVault;
let service: DeadlineService;
beforeAll(async () => {
  v = await createIndexedVault({ files: FILES, now: clock.now });
  service = createDeadlineService(v.index, clock.now);
});
afterAll(() => v.cleanup());

describe('deadline items respect content classes (F9.4)', () => {
  it('items() matches the table exactly, archived only on request', () => {
    for (const includeArchive of [false, true]) {
      const got = service
        .items({ includeArchive })
        .map(({ id, date, done, urgency }) => ({ id, date, done, urgency }));
      const want = visible(includeArchive).map(({ archived: _a, ...rest }) => rest);
      expect(got.sort((a, b) => (a.id < b.id ? -1 : 1))).toEqual(
        want.sort((a, b) => (a.id < b.id ? -1 : 1)),
      );
    }
  });

  it('templates, sources, wiki pages, control docs and attachments yield nothing, even with a deadline', () => {
    const quiet = QUIET_FILES;
    // The fixture gives the first three a `deadline:` in front matter on purpose.
    expect(v.index.getNote('Templates/Mẫu có hạn.md')?.deadline).toBe('2026-10-22');
    expect(v.index.getNote('wiki/concepts/Đạo hàm.md')?.deadline).toBe('2026-10-23');
    const paths = new Set(service.items({ includeArchive: true }).map((i) => i.path));
    for (const p of quiet) expect(paths.has(p), p).toBe(false);
    const listed = [
      ...service.today().todayTasks,
      ...Object.values(service.tasks({ includeArchive: true })).flat(),
    ].map((t) => t.path);
    for (const p of quiet) expect(listed, p).not.toContain(p);
    expect(service.today().projects.map((p) => p.path)).not.toContain('Templates/Mẫu có hạn.md');
  });

  it('today() strip, summary and overdue agree with the table', () => {
    const view = service.today();
    expect([view.date, view.week]).toEqual([today, { start: '2026-10-19', end: '2026-10-25' }]);
    const open = visible(false).filter((r) => !r.done);
    expect(ids(view.strip.days.flatMap((d) => d.items))).toEqual(
      ids(open.filter((r) => r.date >= today)),
    );
    expect(ids(view.strip.overdue)).toEqual(ids(open.filter((r) => r.date < today)));
    for (const day of view.strip.days) for (const i of day.items) expect(i.date).toBe(day.date);
    expect(view.strip.days).toHaveLength(60);
    // Each open item counts once: the overdue one only as overdue, not again in the week (which
    // runs from today to Sunday) or in today's count (open tasks due today or undated).
    const thisWeek = open.filter((r) => r.date >= today && r.date <= '2026-10-25');
    expect(thisWeek).toHaveLength(4);
    expect(view.summary).toEqual({ deadlinesThisWeek: thisWeek.length, overdue: 1, openToday: 2 });
  });

  it("today's tasks: due today or overdue, plus undated tasks of today's Daily note only", () => {
    expect(service.today().todayTasks.map((t) => [t.title, t.done])).toEqual([
      ['Nộp bài', false],
      ['Có hạn hôm nay', false],
      ['Việc hôm nay không hạn', false],
      ['Việc xong không hạn', true],
    ]);
  });

  it('projects in progress with progress, or none for a project without tasks', () => {
    const empty = '1 Projects/Đồ án trống.md';
    expect(service.today().projects).toEqual([
      {
        path: empty,
        title: 'Đồ án trống',
        deadline: '2026-10-31',
        daysLeft: 10,
        urgency: 'ok',
        progress: null,
        revision: v.index.getNote(empty)!.revision,
      },
      {
        path: P,
        title: 'Đồ án Giải tích',
        deadline: '2026-11-02',
        daysLeft: 12,
        urgency: 'ok',
        progress: { done: 1, total: 6 },
        revision: v.index.getNote(P)!.revision,
      },
    ]);
  });

  it('calendar() lists every item of the grid, done ones included, Monday first', () => {
    for (const includeArchive of [false, true]) {
      const cal = service.calendar('2026-10', { includeArchive });
      expect([cal.start, cal.end, cal.days.length]).toEqual(['2026-09-28', '2026-11-01', 35]);
      expect(cal.days.filter((d) => d.inMonth)).toHaveLength(31);
      const inGrid = visible(includeArchive).filter(
        (r) => r.date >= cal.start && r.date <= cal.end,
      );
      expect(ids(cal.days.flatMap((d) => d.items))).toEqual(ids(inGrid));
    }
    expect(() => service.calendar('2026-13')).toThrow(/month/);
  });

  it('tasks() groups open tasks of user notes, archived ones only on request', () => {
    const titlesOf = (g: { title: string }[]) => g.map((t) => t.title).sort();
    const groups = service.tasks();
    expect(titlesOf(groups.overdue)).toEqual(['Nộp bài']);
    expect(titlesOf(groups.today)).toEqual(['Có hạn hôm nay']);
    expect(titlesOf(groups.next7)).toEqual(['Cùng ngày', 'Làm slide', 'Viết báo cáo']);
    expect(groups.later).toEqual([]);
    expect(titlesOf(groups.noDate)).toEqual(
      ['Không có hạn', 'Sai ngày', 'Việc hôm nay không hạn', 'Việc hôm qua không hạn'].sort(),
    );
    const withArchive = service.tasks({ includeArchive: true });
    expect(titlesOf(withArchive.next7)).toContain('Archived task');
    expect(titlesOf(withArchive.noDate)).toContain('Archived undated');
  });

  it('task items carry the line text and note revision needed to patch them', () => {
    const revision = v.index.getNote(P)!.revision;
    expect(service.items().find((i) => i.title === 'Viết báo cáo')).toMatchObject({
      kind: 'task',
      line: 7,
      lineText: '- [ ] Viết báo cáo 📅 2026-10-22',
      noteTitle: 'Đồ án Giải tích',
      revision,
    });
    expect(service.items().find((i) => i.id === `note:${P}`)?.revision).toBe(revision);
    expect(service.tasks().noDate.find((t) => t.title === 'Không có hạn')?.revision).toBe(revision);
  });
});
