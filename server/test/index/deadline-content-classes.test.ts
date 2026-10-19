import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeadlineService } from '../../src/index/deadline-service.js';
import type { DeadlineService } from '../../src/index/index-types.js';
import {
  createIndexedVault,
  fixtureFiles,
  makeClock,
  type IndexedVault,
} from './helpers/index-test-vault.js';

// Wednesday 21 Oct 2026, 10:00 local. The week is Mon 19 – Sun 25.
const clock = makeClock(new Date(2026, 9, 21, 10, 0));
const today = '2026-10-21';
const FILES = fixtureFiles('content-classes');
const P = '1 Projects/Đồ án Giải tích.md';

/** `task:<path>#<line>` for the fixture line holding `text`. */
function taskId(path: string, text: string): string {
  const line = (FILES[path]?.toString('utf8') ?? '').split('\n').findIndex((l) => l.includes(text));
  if (line === -1) throw new Error(`no line ${text}`);
  return `task:${path}#${line + 1}`;
}

/**
 * The expectation table (SPEC §4.2/§4.7): every item the fixture must produce. Templates,
 * sources, wiki pages, control docs and attachments contribute none; archived ones only on request.
 */
const TABLE = (
  [
    [`note:${P}`, '2026-11-02', false, 'ok', false],
    [taskId(P, 'Viết báo cáo'), '2026-10-22', false, 'urgent', false],
    [taskId(P, 'Làm slide'), '2026-10-26', false, 'soon', false],
    [taskId(P, 'Nộp bài'), '2026-10-19', false, 'urgent', false],
    ['note:1 Projects/Đồ án xong.md', '2026-10-22', true, 'done', false],
    [taskId('1 Projects/Đồ án xong.md', 'Still open'), '2026-10-21', true, 'done', false],
    ['note:1 Projects/Đồ án trống.md', '2026-10-31', false, 'ok', false],
    ['note:1 Projects/Hai mục.md', '2026-10-25', false, 'soon', false],
    [taskId('1 Projects/Hai mục.md', 'Cùng ngày'), '2026-10-25', false, 'soon', false],
    [taskId('Daily/2026-10-21.md', 'Có hạn hôm nay'), today, false, 'urgent', false],
    ['note:4 Archive/Đồ án cũ.md', '2026-10-24', false, 'soon', true],
    [taskId('4 Archive/Đồ án cũ.md', 'Archived task'), '2026-10-23', false, 'urgent', true],
  ] as const
).map(([id, date, done, urgency, archived]) => ({ id, date, done, urgency, archived }));

const visible = (includeArchive: boolean) => TABLE.filter((r) => includeArchive || !r.archived);
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

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
    const quiet = [
      'Templates/Mẫu có hạn.md',
      '3 Resources/web/Bài viết.md',
      'wiki/concepts/Đạo hàm.md',
      'wiki/index.md',
      'CLAUDE.md',
      'Attachments/ghi chú.md',
    ];
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
    const thisWeek = open.filter((r) => r.date >= '2026-10-19' && r.date <= '2026-10-25');
    expect(view.summary).toEqual({ deadlinesThisWeek: thisWeek.length, overdue: 1, openToday: 3 });
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
      },
      {
        path: P,
        title: 'Đồ án Giải tích',
        deadline: '2026-11-02',
        daysLeft: 12,
        urgency: 'ok',
        progress: { done: 1, total: 6 },
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

  it('task items carry the line text needed to patch them', () => {
    expect(service.items().find((i) => i.title === 'Viết báo cáo')).toMatchObject({
      kind: 'task',
      line: 7,
      lineText: '- [ ] Viết báo cáo 📅 2026-10-22',
      noteTitle: 'Đồ án Giải tích',
    });
  });
});
