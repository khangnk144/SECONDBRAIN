import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IndexEvent } from '../../src/index/event-log.js';
import { gateVaultReads } from './helpers/gated-vault.js';
import { createIndexedVault, makeClock, type IndexedVault } from './helpers/index-test-vault.js';

const clock = makeClock(new Date(2026, 9, 21, 9, 30));
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

async function freshVault(files: Record<string, string>) {
  v = await createIndexedVault({ files, now: clock.now });
  return v;
}

/** Events appended by `action`, without timestamps. */
async function eventsOf(vault: IndexedVault, action: () => Promise<unknown>) {
  const before = readEvents(vault).length;
  await action();
  return readEvents(vault)
    .slice(before)
    .map(({ ts: _ts, ...rest }) => rest);
}

describe('event log (durable state/events.jsonl)', () => {
  it('the first index writes one approximate note_created per note, dated from created or mtime', async () => {
    const vault = await freshVault({
      '2 Areas/Giải tích 1.md': '---\ncreated: 2026-09-01\n---\nNội dung bí mật.\n',
      '0 Inbox/Không ngày.md': 'Ghi chú [[Giải tích 1]].\n',
      'Attachments/hình.png': 'png',
    });
    const events = readEvents(vault);
    expect(events.every((e) => e.event === 'note_created' && e.approx === true)).toBe(true);
    const paths = events.map((e) => e.path);
    expect(paths).toContain('2 Areas/Giải tích 1.md');
    expect(paths).toContain('0 Inbox/Không ngày.md');
    expect(paths).not.toContain('Attachments/hình.png');
    const course = events.find((e) => e.path === '2 Areas/Giải tích 1.md');
    expect(course?.ts).toBe(new Date(2026, 8, 1).toISOString());
    expect(events.map((e) => e.ts)).toEqual([...events.map((e) => e.ts)].sort());
    expect(readFileSync(vault.vault.paths.eventsFile, 'utf8')).not.toContain('bí mật');
  });

  it('logs creation with links, edits as link differences, rename and deletion', async () => {
    const vault = await freshVault({ '2 Areas/Đích.md': 'Đích.\n' });
    expect(
      await eventsOf(vault, () => vault.put('0 Inbox/Mới.md', 'Xem [[Đích]] và [[Ma]].\n')),
    ).toEqual([
      { event: 'note_created', path: '0 Inbox/Mới.md' },
      { event: 'link_added', path: '0 Inbox/Mới.md', target: '2 Areas/Đích.md' },
      { event: 'link_added', path: '0 Inbox/Mới.md', target: 'Ma' },
    ]);
    expect(
      await eventsOf(vault, () => vault.put('0 Inbox/Mới.md', 'Chỉ còn [[Ma]] và [[Khác]].\n')),
    ).toEqual([
      { event: 'link_removed', path: '0 Inbox/Mới.md', target: '2 Areas/Đích.md' },
      { event: 'link_added', path: '0 Inbox/Mới.md', target: 'Khác' },
    ]);
    expect(await eventsOf(vault, () => vault.index.updateFile('0 Inbox/Mới.md'))).toEqual([]);
    vault.renameFile('0 Inbox/Mới.md', '1 Projects/Mới.md');
    expect(
      await eventsOf(vault, () => vault.index.renameFile('0 Inbox/Mới.md', '1 Projects/Mới.md')),
    ).toEqual([{ event: 'note_renamed', path: '1 Projects/Mới.md', oldPath: '0 Inbox/Mới.md' }]);
    vault.removeFile('1 Projects/Mới.md');
    expect(await eventsOf(vault, () => vault.index.removeFile('1 Projects/Mới.md'))).toEqual([
      { event: 'note_deleted', path: '1 Projects/Mới.md' },
    ]);
  });

  it('a ghost link becoming resolved is logged on the linking note', async () => {
    const vault = await freshVault({ '0 Inbox/Nháp.md': 'Xem [[Sắp có]].\n' });
    expect(await eventsOf(vault, () => vault.put('2 Areas/Sắp có.md', 'Có rồi.\n'))).toEqual([
      { event: 'note_created', path: '2 Areas/Sắp có.md' },
      { event: 'link_removed', path: '0 Inbox/Nháp.md', target: 'Sắp có' },
      { event: 'link_added', path: '0 Inbox/Nháp.md', target: '2 Areas/Sắp có.md' },
    ]);
  });

  it('logs nothing for non-note files and nothing for a rebuild when the log exists', async () => {
    const vault = await freshVault({ '0 Inbox/A.md': 'a\n' });
    vault.writeFile('Attachments/x.png', 'x');
    expect(await eventsOf(vault, () => vault.index.updateFile('Attachments/x.png'))).toEqual([]);
    expect(await eventsOf(vault, () => vault.index.rebuild())).toEqual([]);
    vault.index.close();
    // A corrupt index rebuilt from scratch on open: still nothing, the log already exists.
    const db = path.join(vault.vault.paths.cacheDir, 'index.sqlite');
    writeFileSync(db, 'garbage');
    expect(await eventsOf(vault, () => vault.reopen())).toEqual([]);
    expect(await vault.index.open()).toEqual({ rebuilt: true, reason: 'corrupt' });
  });

  it('changes made while closed are logged by the reconcile on open', async () => {
    const vault = await freshVault({ '0 Inbox/A.md': 'a\n' });
    vault.index.close();
    vault.writeFile('0 Inbox/B.md', 'b [[A]]\n');
    vault.renameFile('0 Inbox/A.md', '2 Areas/A.md');
    const events = await eventsOf(vault, () => vault.reopen());
    expect(events).toEqual(
      expect.arrayContaining([
        { event: 'note_renamed', path: '2 Areas/A.md', oldPath: '0 Inbox/A.md' },
        { event: 'note_created', path: '0 Inbox/B.md' },
        { event: 'link_added', path: '0 Inbox/B.md', target: '2 Areas/A.md' },
      ]),
    );
  });

  it('a change queued behind a rebuild is diffed against the index it replaced', async () => {
    const vault = await freshVault({ '0 Inbox/A.md': 'a\n', '2 Areas/Đích.md': 'đích\n' });
    const gated = gateVaultReads(vault.vault);
    const index = await vault.reopen({ vault: gated.vault });
    gated.close();
    const waiting = gated.waiting();
    const events = eventsOf(vault, async () => {
      const rebuild = index.rebuild();
      await waiting;
      // Edited during the rebuild: the rebuild itself will already read the new text.
      vault.writeFile('0 Inbox/A.md', 'a [[Đích]]\n');
      const update = index.updateFile('0 Inbox/A.md');
      gated.open();
      await Promise.all([rebuild, update]);
    });
    expect(await events).toEqual([
      { event: 'link_added', path: '0 Inbox/A.md', target: '2 Areas/Đích.md' },
    ]);
  });
});

describe('event log across a rebuild', () => {
  it('a note whose link target disappears during a rebuild still logs its link change', async () => {
    const vault = await freshVault({
      '2 Areas/Đích.md': 'đích\n',
      '0 Inbox/Nối.md': 'xem [[Đích]]\n',
    });
    const gated = gateVaultReads(vault.vault);
    const index = await vault.reopen({ vault: gated.vault });
    gated.close();
    const waiting = gated.waiting();
    const events = eventsOf(vault, async () => {
      const rebuild = index.rebuild();
      await waiting;
      vault.removeFile('2 Areas/Đích.md');
      const removed = index.removeFile('2 Areas/Đích.md');
      gated.open();
      await Promise.all([rebuild, removed]);
    });
    expect(await events).toEqual([
      { event: 'note_deleted', path: '2 Areas/Đích.md' },
      { event: 'link_removed', path: '0 Inbox/Nối.md', target: '2 Areas/Đích.md' },
      { event: 'link_added', path: '0 Inbox/Nối.md', target: 'Đích' },
    ]);
  });
});
