import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../testing/fetch-mock';
import { getDaily, getDailyNeighbors, postCapture, postDaily } from './capture-daily-api';
import { getCalendar, getTasks, getToday, patchTask, postReschedule } from './deadlines-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOTE = '1 Projects/Đồ án Giải tích.md';

describe('deadline, capture and daily endpoints', () => {
  it('reads Today, a calendar month and the task groups; includeArchive only when asked', async () => {
    const mock = installFetchMock();
    mock.on('GET /api/today', { body: { date: '2026-10-19' } });
    mock.on('GET /api/calendar', { body: { month: '2026-11' } });
    mock.on('GET /api/tasks', { body: { overdue: [] } });

    await expect(getToday()).resolves.toEqual({ date: '2026-10-19' });
    await getCalendar('2026-11');
    await getCalendar('2026-11', { includeArchive: true });
    await getTasks();
    await getTasks({ includeArchive: true });

    expect(mock.calls.map((c) => c.url)).toEqual([
      '/api/today',
      '/api/calendar?month=2026-11',
      '/api/calendar?month=2026-11&includeArchive=true',
      '/api/tasks',
      '/api/tasks?includeArchive=true',
    ]);
  });

  it('patches a task line and reschedules with the revision and the expected line text', async () => {
    const mock = installFetchMock();
    mock.on('PATCH /api/note/task', {
      body: { revision: 'r2', lineText: '- [x] Nộp ✅ 2026-10-19' },
    });
    mock.on('POST /api/note/reschedule', { body: { revision: 'r3', journalId: 'J1' } });

    await expect(
      patchTask({
        path: NOTE,
        expectedRevision: 'r1',
        line: 7,
        expectedText: '- [ ] Nộp',
        done: true,
      }),
    ).resolves.toEqual({ revision: 'r2', lineText: '- [x] Nộp ✅ 2026-10-19' });
    await postReschedule({
      path: NOTE,
      expectedRevision: 'r2',
      target: { kind: 'task', line: 7, expectedText: '- [ ] Nộp 📅 2026-10-20' },
      date: '2026-10-25',
    });
    await postReschedule({
      path: NOTE,
      expectedRevision: 'r3',
      target: { kind: 'note' },
      date: '2026-11-05',
    });

    expect(mock.calls.map((c) => c.body)).toEqual([
      { path: NOTE, expectedRevision: 'r1', line: 7, expectedText: '- [ ] Nộp', done: true },
      {
        path: NOTE,
        expectedRevision: 'r2',
        target: { kind: 'task', line: 7, expectedText: '- [ ] Nộp 📅 2026-10-20' },
        date: '2026-10-25',
      },
      { path: NOTE, expectedRevision: 'r3', target: { kind: 'note' }, date: '2026-11-05' },
    ]);
  });

  it('captures text as typed and reaches the daily routes with the date in query or body', async () => {
    const mock = installFetchMock();
    mock.on('POST /api/capture', {
      status: 201,
      body: { path: '0 Inbox/Gọi mẹ.md', revision: 'r' },
    });
    mock.on('GET /api/daily', { body: { path: 'Daily/2026-10-19.md', revision: 'r' } });
    mock.on('POST /api/daily', {
      status: 201,
      body: { path: 'Daily/2026-10-20.md', revision: 'r', cursor: 42 },
    });
    mock.on('GET /api/daily/neighbors', { body: { previous: '2026-10-17', next: null } });

    await expect(postCapture('Gọi mẹ\nlúc 8 giờ')).resolves.toEqual({
      path: '0 Inbox/Gọi mẹ.md',
      revision: 'r',
    });
    await getDaily('2026-10-19');
    await expect(postDaily('2026-10-20')).resolves.toMatchObject({ cursor: 42 });
    await expect(getDailyNeighbors('2026-10-19')).resolves.toEqual({
      previous: '2026-10-17',
      next: null,
    });

    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'Gọi mẹ\nlúc 8 giờ' });
    expect(mock.callsTo('GET /api/daily')[0]?.url).toBe('/api/daily?date=2026-10-19');
    expect(mock.callsTo('POST /api/daily')[0]?.body).toEqual({ date: '2026-10-20' });
    expect(mock.callsTo('GET /api/daily/neighbors')[0]?.query.get('date')).toBe('2026-10-19');
  });
});
