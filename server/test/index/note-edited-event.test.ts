import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDailyTouches } from '../../src/index/daily-touches.js';
import type { IndexEvent } from '../../src/index/event-log.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createIndexedVault, makeClock, type IndexedVault } from './helpers/index-test-vault.js';

const NOTE = '2 Areas/Đồ án Giải tích.md';
let v: IndexedVault | null = null;
afterEach(async () => {
  await v?.cleanup();
  v = null;
});

function readEvents(vault: IndexedVault): IndexEvent[] {
  const file = vault.vault.paths.eventsFile;
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IndexEvent);
}
const edits = (vault: IndexedVault) => readEvents(vault).filter((e) => e.event === 'note_edited');

describe('note_edited (F35.9): at most once per note per local day', () => {
  it('(F35.9) 50 saves of an existing note on one day write exactly one path-only line', async () => {
    const clock = makeClock(new Date(2026, 9, 21, 9, 30));
    v = await createIndexedVault({ files: { [NOTE]: 'Bản đầu, bí mật.\n' }, now: clock.now });
    for (let i = 0; i < 50; i += 1) {
      clock.set(new Date(2026, 9, 21, 9, 31 + i));
      await v.put(NOTE, `Lần sửa ${i}, nội dung riêng tư.\n`);
    }
    expect(edits(v)).toEqual([
      { ts: new Date(2026, 9, 21, 9, 31).toISOString(), event: 'note_edited', path: NOTE },
    ]);
    expect(readFileSync(v.vault.paths.eventsFile, 'utf8')).not.toMatch(/riêng tư|bí mật/);

    clock.set(new Date(2026, 9, 22, 0, 5)); // the next local day
    await v.put(NOTE, 'Ngày mới.\n');
    await v.put(NOTE, 'Ngày mới, lần hai.\n');
    expect(edits(v).map((e) => e.ts)).toEqual([
      new Date(2026, 9, 21, 9, 31).toISOString(),
      new Date(2026, 9, 22, 0, 5).toISOString(),
    ]);
  });

  it('(F35.9) a note created today counts as touched: its edits that day add no line', async () => {
    const clock = makeClock(new Date(2026, 9, 21, 10, 0));
    v = await createIndexedVault({ now: clock.now });
    await v.put('0 Inbox/Mới.md', 'một\n');
    await v.put('0 Inbox/Mới.md', 'hai [[Đích]]\n');
    const events = readEvents(v)
      .filter((e) => !e.approx) // the vault's templates, reconstructed by the first index
      .map(({ ts: _ts, ...rest }) => rest);
    expect(events).toEqual([
      { event: 'note_created', path: '0 Inbox/Mới.md' },
      { event: 'link_added', path: '0 Inbox/Mới.md', target: 'Đích' },
    ]);
  });

  it('logs the edit with the link differences; nothing for same bytes or non-notes', async () => {
    const clock = makeClock(new Date(2026, 9, 21, 10, 0));
    v = await createIndexedVault({ files: { [NOTE]: 'a\n' }, now: clock.now });
    const before = readEvents(v).length;
    await v.put(NOTE, 'a [[Ma]]\n');
    expect(
      readEvents(v)
        .slice(before)
        .map(({ ts: _ts, ...rest }) => rest),
    ).toEqual([
      { event: 'link_added', path: NOTE, target: 'Ma' },
      { event: 'note_edited', path: NOTE },
    ]);
    clock.set(new Date(2026, 9, 22, 10, 0));
    await v.index.updateFile(NOTE); // same bytes
    v.writeFile('Attachments/hình.png', 'png');
    await v.index.updateFile('Attachments/hình.png');
    v.writeFile('Attachments/hình.png', 'png 2');
    await v.index.updateFile('Attachments/hình.png');
    expect(edits(v)).toHaveLength(1);
  });

  it('the mark follows a rename, and survives a restart the same day (seeded from the log)', async () => {
    const clock = makeClock(new Date(2026, 9, 21, 10, 0));
    v = await createIndexedVault({ files: { [NOTE]: 'a\n' }, now: clock.now });
    await v.put(NOTE, 'b\n');
    const renamed = '1 Projects/Đồ án Giải tích.md';
    v.renameFile(NOTE, renamed);
    await v.index.renameFile(NOTE, renamed);
    await v.put(renamed, 'c\n');
    await v.reopen();
    await v.put(renamed, 'd\n');
    expect(edits(v).map((e) => e.path)).toEqual([NOTE]);
  });

  it('an edit made while the app was closed is logged by the reconcile on open', async () => {
    const clock = makeClock(new Date(2026, 9, 21, 10, 0));
    v = await createIndexedVault({ files: { [NOTE]: 'a\n' }, now: clock.now });
    v.index.close();
    v.writeFile(NOTE, 'sửa bằng app khác\n');
    clock.set(new Date(2026, 9, 23, 8, 0));
    await v.reopen();
    expect(edits(v)).toEqual([
      { ts: new Date(2026, 9, 23, 8, 0).toISOString(), event: 'note_edited', path: NOTE },
    ]);
  });
});

describe('daily touches: seeding reads only the end of a big log', () => {
  it('finds the day’s lines in the tail and ignores older days and approximate history', () => {
    const dir = makeTempDir('sb nhật ký sự kiện');
    try {
      const file = path.join(dir, 'events.jsonl');
      const old = new Date(2026, 9, 20, 12, 0).toISOString();
      const line = (e: IndexEvent) => `${JSON.stringify(e)}\n`;
      // ~200 KB of yesterday, then today's lines: the tail (64 KB here) holds all of today.
      writeFileSync(file, '');
      for (let i = 0; i < 2000; i += 1)
        appendFileSync(file, line({ ts: old, event: 'note_edited', path: `2 Areas/Cũ ${i}.md` }));
      const today = (h: number) => new Date(2026, 9, 21, h, 0).toISOString();
      appendFileSync(file, line({ ts: today(8), event: 'note_edited', path: 'A.md' }));
      appendFileSync(file, line({ ts: today(9), event: 'note_created', path: 'B.md' }));
      appendFileSync(
        file,
        line({ ts: today(9), event: 'note_renamed', path: 'C.md', oldPath: 'B.md' }),
      );
      appendFileSync(
        file,
        line({ ts: today(1), event: 'note_created', path: 'D.md', approx: true }),
      );
      const touches = createDailyTouches(file, 64 * 1024);
      const edit = (p: string): IndexEvent => ({ ts: today(10), event: 'note_edited', path: p });
      expect(touches.accept(edit('A.md'))).toBe(false);
      expect(touches.accept(edit('C.md'))).toBe(false);
      expect(touches.accept(edit('D.md'))).toBe(true); // approx lines are not today's work
      expect(touches.accept(edit('D.md'))).toBe(false);
      expect(touches.accept(edit('2 Areas/Cũ 1.md'))).toBe(true); // yesterday's mark is gone
      // Unreadable timestamps and other events always pass.
      expect(touches.accept({ ts: 'garbage', event: 'note_edited', path: 'A.md' })).toBe(true);
      expect(
        touches.accept({ ts: today(11), event: 'link_added', path: 'A.md', target: 'X' }),
      ).toBe(true);
    } finally {
      removeDir(dir);
    }
  });
});
