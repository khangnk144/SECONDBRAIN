import { afterEach, describe, expect, it } from 'vitest';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  note,
  PAGE,
  startSemesterHost,
  type SemesterHost,
} from '../semester/semester-test-host.js';

/** Local time; months are 1-based here. */
const at = (mo: number, d: number, h: number, mi = 0) => new Date(2026, mo - 1, d, h, mi);
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const projectText = (ticked: boolean) =>
  note(
    { type: 'project', status: 'doing', deadline: '2026-03-14', created: '2026-03-02' },
    [
      `- [${ticked ? 'x' : ' '}] Nộp bài 1${ticked ? ' ✅ 2026-03-04' : ''}`,
      '- [ ] Đọc chương 2 📅 2026-03-10',
      '- [x] Gửi email 📅 2026-03-09 ✅ 2026-03-01',
      '- [ ] Ôn thi 📅 2026-03-16',
      '- [ ] Làm slide 📅 2026-03-08',
      '',
    ].join('\n'),
  );

let h: SemesterHost | null = null;
afterEach(async () => {
  await h?.t.close();
  h = null;
});

/**
 * A week of work through the vault service under a mocked clock (the event log gets those
 * days): Sat 28/2 before the week, then Mon 2/3 … Sun 8/3.
 */
async function weekOfWork() {
  const clock = makeClock(at(2, 28, 10));
  h = await startSemesterHost(47841, { now: clock.now });
  const { write } = h;
  await write(
    '2 Areas/Cũ hơn.md',
    note({ created: '2026-02-28' }, '- [x] Việc cũ ✅ 2026-02-28\n'),
  );
  clock.set(at(3, 2, 9));
  await write(PROJECT, projectText(false));
  await write('0 Inbox/A.md', note({ created: '2026-03-02' }, '# A\n'));
  await write('0 Inbox/B.md', '# B\n');
  await write('0 Inbox/Chủ đề/C.md', note({ created: '2026-03-02' }, '# C\n'));
  await write('Templates/Mẫu.md', '- [x] Việc mẫu ✅ 2026-03-03\n');
  clock.set(at(3, 4, 15));
  await write(PROJECT, projectText(true));
  await write('wiki/Khái niệm.md', '# Khái niệm\n');
  await write('4 Archive/Cũ.md', note({ created: '2026-03-04' }, '# Cũ\n'));
  // The generated page is on: it never counts as her work.
  await h.service().act('enable');
  clock.set(at(3, 7, 21));
  await write(
    'Daily/2026-03-07.md',
    note({ type: 'daily', created: '2026-03-07' }, '- [x] Đọc ✅ 2026-03-07\n'),
  );
  clock.set(at(3, 8, 20));
  await write('0 Inbox/A.md', note({ created: '2026-03-02' }, '# A sửa\n'));
  return { h, clock };
}

describe('GET /api/review/week (F26.1, F26.3)', () => {
  it('(F26.1) counts the Inbox, the notes and tasks of the 7 days, and next week’s deadlines', async () => {
    const { h } = await weekOfWork();
    const res = await h.t.call('GET', '/api/review/week?end=2026-03-08');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body).toMatchObject({
      start: '2026-03-02',
      end: '2026-03-08',
      inbox: { count: 2 },
      upcoming: { count: 2, from: '2026-03-09', to: '2026-03-15' },
    });
    expect(body.notes.count).toBe(6);
    expect(
      body.notes.items.map((n: { path: string; change: string; day: string }) => [
        n.path,
        n.change,
        n.day,
      ]),
    ).toEqual([
      ['0 Inbox/A.md', 'created', '2026-03-08'],
      ['Daily/2026-03-07.md', 'created', '2026-03-07'],
      ['4 Archive/Cũ.md', 'created', '2026-03-04'],
      [PROJECT, 'created', '2026-03-04'],
      ['0 Inbox/B.md', 'edited', '2026-03-02'],
      ['0 Inbox/Chủ đề/C.md', 'created', '2026-03-02'],
    ]);
    expect(body.notes.items[3]).toMatchObject({ title: 'Đồ án Giải tích', folder: '1 Projects' });
    expect(body.notes.items.some((n: { path: string }) => n.path === PAGE)).toBe(false);
    expect(body.tasksDone).toEqual({
      count: 2,
      items: [
        {
          path: 'Daily/2026-03-07.md',
          noteTitle: '2026-03-07',
          line: 5,
          text: 'Đọc',
          completed: '2026-03-07',
        },
        {
          path: PROJECT,
          noteTitle: 'Đồ án Giải tích',
          line: 7,
          text: 'Nộp bài 1',
          completed: '2026-03-04',
        },
      ],
    });
  });

  it('(F26.3) without `end` the week ends today by the clock: Sunday 23:59, then Monday 00:00', async () => {
    const { h, clock } = await weekOfWork();
    clock.set(at(3, 8, 23, 59));
    const sunday = (await h.t.call('GET', '/api/review/week')).json();
    expect(sunday).toMatchObject({ start: '2026-03-02', end: '2026-03-08' });
    expect(sunday.notes.count).toBe(6);
    clock.set(at(3, 9, 0, 0));
    const monday = (await h.t.call('GET', '/api/review/week')).json();
    expect(monday).toMatchObject({ start: '2026-03-03', end: '2026-03-09' });
    // B and C were only touched on Monday 2/3, which left the window.
    expect(monday.notes.count).toBe(4);
    expect(monday.tasksDone.count).toBe(2);
  });

  it('refuses a date that does not exist and changes nothing', async () => {
    const { h } = await weekOfWork();
    const res = await h.t.call('GET', '/api/review/week?end=2026-02-30');
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('(F26.1) a date at the edge of the calendar is a 400, never a 500 (review L9)', async () => {
    const { h } = await weekOfWork();
    for (const end of ['9999-12-31', '9998-12-31x', '1000-01-01', '1969-12-31', '0000-01-01']) {
      const res = await h.t.call('GET', `/api/review/week?end=${end}`);
      expect(res.statusCode, end).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason: 'end' } });
    }
    for (const end of ['9998-12-31', '1970-01-01']) {
      const res = await h.t.call('GET', `/api/review/week?end=${end}`);
      expect(res.statusCode, end).toBe(200);
    }
  });
});
