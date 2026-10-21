import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FIXTURE_FILES,
  FIXTURE_NOW,
  FIXTURE_TODAY,
  QUIET_FILES,
  sortedIds,
  visibleItems,
} from '../index/helpers/content-class-expectations.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

const PORT = 4845;

interface Item {
  id: string;
  path: string;
  title: string;
  date: string;
  done: boolean;
}

describe('Today, Calendar and Tasks agree with the content-class table through the API (F9.4, F14.3)', () => {
  let t: VaultTestApp;
  const clock = makeClock(FIXTURE_NOW);
  const get = async (url: string) => (await t.call('GET', url)).json();

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: clock.now,
      seed: (root) => {
        for (const [p, bytes] of Object.entries(FIXTURE_FILES)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), bytes);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('each answer is exactly the deadline service', async () => {
    const { deadlines } = t.context;
    expect(await get('/api/today')).toEqual(deadlines.today());
    for (const includeArchive of [false, true]) {
      expect(await get(`/api/calendar?month=2026-10&includeArchive=${includeArchive}`)).toEqual(
        deadlines.calendar('2026-10', { includeArchive }),
      );
      expect(await get(`/api/tasks?includeArchive=${includeArchive}`)).toEqual(
        deadlines.tasks({ includeArchive }),
      );
    }
  });

  it('Today: the strip and overdue cell hold exactly the open items of the table', async () => {
    const view = await get('/api/today');
    const open = visibleItems(false).filter((r) => !r.done);
    const strip = view.strip.days.flatMap((d: { items: Item[] }) => d.items) as Item[];
    expect(sortedIds(strip)).toEqual(sortedIds(open.filter((r) => r.date >= FIXTURE_TODAY)));
    expect(sortedIds(view.strip.overdue)).toEqual(
      sortedIds(open.filter((r) => r.date < FIXTURE_TODAY)),
    );
    expect(view.todayTasks.map((i: Item) => i.title)).toEqual([
      'Nộp bài',
      'Có hạn hôm nay',
      'Việc hôm nay không hạn',
      'Việc xong không hạn',
    ]);
  });

  it('Calendar: every item of the grid, done ones included, archived only on request', async () => {
    for (const includeArchive of [false, true]) {
      const cal = await get(`/api/calendar?month=2026-10&includeArchive=${includeArchive}`);
      const items = cal.days.flatMap((d: { items: Item[] }) => d.items) as Item[];
      const want = visibleItems(includeArchive).filter(
        (r) => r.date >= cal.start && r.date <= cal.end,
      );
      expect(sortedIds(items)).toEqual(sortedIds(want));
      expect(
        items
          .filter((i) => i.done)
          .map((i) => i.id)
          .sort(),
      ).toEqual(sortedIds(want.filter((r) => r.done)));
    }
  });

  it('Tasks and every other view list nothing from templates, sources, wiki, control docs or attachments', async () => {
    const groups = await get('/api/tasks?includeArchive=true');
    const listed = [
      ...Object.values(groups).flat(),
      ...(await get('/api/today')).todayTasks,
      ...(await get('/api/calendar?month=2026-10&includeArchive=true')).days.flatMap(
        (d: { items: Item[] }) => d.items,
      ),
    ].map((i) => (i as Item).path);
    for (const quiet of QUIET_FILES) expect(listed, quiet).not.toContain(quiet);
    expect(groups.overdue.map((i: Item) => i.title)).toEqual(['Nộp bài']);
  });
});

describe('Today follows the clock through the API (F9.3)', () => {
  let t: VaultTestApp;
  const clock = makeClock(new Date(2026, 9, 21, 23, 59));
  const today = async () => (await t.call('GET', '/api/today')).json();

  beforeAll(async () => {
    t = await createVaultTestApp(PORT + 1, {
      now: clock.now,
      seed: (root) => {
        for (const [p, bytes] of Object.entries(FIXTURE_FILES)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), bytes);
        }
      },
    });
  });
  afterAll(async () => t?.close());

  it('23:59 → 00:00 moves the buckets without any file change', async () => {
    const before = await today();
    expect(before.date).toBe('2026-10-21');
    expect(before.summary).toMatchObject({ overdue: 1, openToday: 2 });
    expect(before.strip.days[0].date).toBe('2026-10-21');
    clock.set(new Date(2026, 9, 22, 0, 0));
    const after = await today();
    expect(after.date).toBe('2026-10-22');
    expect(after.strip.days[0].date).toBe('2026-10-22');
    expect(after.strip.overdue.map((i: Item) => i.title)).toEqual(['Nộp bài', 'Có hạn hôm nay']);
    expect(after.todayTasks.map((i: Item) => i.title)).toEqual([
      'Nộp bài',
      'Có hạn hôm nay',
      'Viết báo cáo',
    ]);
    expect(after.summary).toMatchObject({ overdue: 2, openToday: 1 });
    const tasks = (await t.call('GET', '/api/tasks')).json();
    expect(tasks.today.map((i: Item) => i.title)).toEqual(['Viết báo cáo']);
  });
});
