import { afterEach, describe, expect, it } from 'vitest';
import { createActivityService } from '../../src/index/activity-service.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import { createIndexedVault, makeClock, type IndexedVault } from './helpers/index-test-vault.js';

const PROJECT = '1 Projects/Đồ án Giải tích.md';
// March, far from any real file mtime of a test run, so the mtime fallback never adds a note.
const clock = makeClock(new Date(2026, 2, 2, 9, 0));
let v: IndexedVault | null = null;
let t: VaultTestApp | null = null;
afterEach(async () => {
  await v?.cleanup();
  await t?.close();
  v = null;
  t = null;
});

describe('activity service on a real index (F35.9, used by Today, the review and the brain tile)', () => {
  it('(F35.9) counts touched notes per day, done tasks of user notes and links added', async () => {
    clock.set(new Date(2026, 2, 2, 9, 0));
    v = await createIndexedVault({ now: clock.now });
    await v.put(
      PROJECT,
      '- [x] Nộp bài tập ✅ 2026-03-02\n- [x] Đọc chương 3 ✅ 2026-03-03\n- [ ] Viết báo cáo\n',
    );
    await v.put('Templates/Mẫu.md', '- [x] Việc mẫu ✅ 2026-03-03\n');
    await v.put('4 Archive/Cũ.md', '- [x] Việc cũ ✅ 2026-03-03\n');
    clock.set(new Date(2026, 2, 3, 20, 0));
    await v.put(PROJECT, '- [x] Nộp bài tập ✅ 2026-03-02\n- [x] Đọc chương 3 ✅ 2026-03-03\n');
    await v.put('2 Areas/Khái niệm.md', 'Xem [[Đồ án Giải tích]] và [[Chưa có]].\n');
    // A page the AI wrote: neither a touched note of hers nor her link (review L3).
    await v.put('wiki/Ma trận.md', 'Xem [[Đồ án Giải tích]].\n');

    const activity = createActivityService({
      eventsFile: v.vault.paths.eventsFile,
      index: v.index,
      now: clock.now,
    });
    expect(activity.today()).toBe('2026-03-03');
    const touched = await activity.touchedNotesByDay('2026-03-02', '2026-03-03');
    expect([...(touched.get('2026-03-02') ?? [])].sort()).toEqual([PROJECT, '4 Archive/Cũ.md']);
    expect([...(touched.get('2026-03-03') ?? [])].sort()).toEqual([
      PROJECT,
      '2 Areas/Khái niệm.md',
    ]);

    expect(activity.doneTasksOn('2026-03-03')).toEqual([
      {
        path: PROJECT,
        noteTitle: 'Đồ án Giải tích',
        line: 2,
        text: 'Đọc chương 3',
        completed: '2026-03-03',
      },
    ]);
    expect(activity.doneTasksBetween('2026-03-01', '2026-03-03').map((x) => x.text)).toEqual([
      'Đọc chương 3',
      'Nộp bài tập',
    ]);
    expect(await activity.linksAddedOn('2026-03-03')).toEqual([
      { from: '2 Areas/Khái niệm.md', to: PROJECT, resolved: true },
      { from: '2 Areas/Khái niệm.md', to: 'Chưa có', resolved: false },
    ]);
    expect(() => activity.doneTasksOn('03/03/2026')).toThrow(RangeError);
  });

  it('routes reach it as context.activity (the vault open now)', async () => {
    clock.set(new Date(2026, 2, 3, 9, 0));
    t = await createVaultTestApp(47762, { now: clock.now, watcher: false });
    const { activity } = t.context;
    expect(activity.today()).toBe('2026-03-03');
    const week = await activity.touchedNotesByDay('2026-02-25', '2026-03-03');
    expect([...week.keys()]).toHaveLength(7);
    expect(activity.doneTasksBetween('2026-02-25', '2026-03-03')).toEqual([]);
  });
});
