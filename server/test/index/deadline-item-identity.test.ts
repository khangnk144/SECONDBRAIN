import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDeadlineService } from '../../src/index/deadline-service.js';
import type { DeadlineService } from '../../src/index/index-types.js';
import {
  createIndexedVault,
  fixtureFiles,
  makeClock,
  type IndexedVault,
} from './helpers/index-test-vault.js';

const clock = makeClock(new Date(2026, 9, 21, 10, 0));
let v: IndexedVault;
let service: DeadlineService;
beforeAll(async () => {
  v = await createIndexedVault({ files: fixtureFiles('content-classes'), now: clock.now });
  service = createDeadlineService(v.index, clock.now);
});
afterAll(() => v.cleanup());

describe('deadline item identity (F9.5)', () => {
  it('a note deadline without tasks is one item', () => {
    const items = service.items().filter((i) => i.path === '1 Projects/Đồ án trống.md');
    expect(items.map((i) => i.id)).toEqual(['note:1 Projects/Đồ án trống.md']);
  });

  it('a note deadline and a task on the same day are two items', () => {
    const same = service.items().filter((i) => i.path === '1 Projects/Hai mục.md');
    expect(same.map((i) => [i.kind, i.date, i.id]).sort()).toEqual([
      ['note', '2026-10-25', 'note:1 Projects/Hai mục.md'],
      ['task', '2026-10-25', 'task:1 Projects/Hai mục.md#4'],
    ]);
  });

  it('item ids are unique in every view', () => {
    const unique = (list: { id: string }[]) => new Set(list.map((i) => i.id)).size === list.length;
    expect(unique(service.items({ includeArchive: true }))).toBe(true);
    expect(unique(service.today().strip.days.flatMap((d) => d.items))).toBe(true);
    expect(
      unique(service.calendar('2026-10', { includeArchive: true }).days.flatMap((d) => d.items)),
    ).toBe(true);
    const groups = Object.values(service.tasks({ includeArchive: true })).flat();
    expect(unique(groups)).toBe(true);
  });

  it('rejects malformed date ranges instead of guessing', () => {
    expect(() => service.items({ from: '2026-02-30' })).toThrow(/calendar date/);
    expect(
      service
        .items({ from: '2026-10-25', to: '2026-10-25' })
        .map((i) => i.kind)
        .sort(),
    ).toEqual(['note', 'task']);
  });
});
