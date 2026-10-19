import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndexedVault, titles, type IndexedVault } from './helpers/index-test-vault.js';

let v: IndexedVault;
beforeEach(async () => {
  v = await createIndexedVault({
    files: {
      '2 Areas/Giải tích 1.md':
        '---\ntags: [môn]\n---\nĐạo hàm. Xem [[Đại số]].\n- [ ] Bài tập 📅 2026-10-30\n',
      '2 Areas/Đại số.md': 'Ma trận.\n',
      '0 Inbox/Nháp.md': 'Ghi chú [[Bài 1]] và ![[bảng.png]] và [[Chưa có]].\n',
      '2 Areas/Giải tích 1/Bài 1.md': 'Bài một của giải tích.\n',
    },
  });
});
afterEach(() => v.cleanup());

const rowId = (p: string) => {
  const db = new Database(path.join(v.vault.paths.cacheDir, 'index.sqlite'), { readonly: true });
  try {
    return db.prepare('SELECT id FROM notes WHERE path = ?').pluck().get(p) as number | undefined;
  } finally {
    db.close();
  }
};
const outlink = (from: string, target: string) =>
  v.index.outlinks(from).find((l) => l.target === target);

describe('incremental index updates', () => {
  it('an outside edit of one file updates its links, tags, tasks and full text', async () => {
    expect(titles(v.index.search({ q: 'dao ham' }))).toContain('Giải tích 1');
    await v.put(
      '2 Areas/Giải tích 1.md',
      '---\ntags: [toán]\n---\nTích phân. Xem [[Chưa có]].\n- [x] Bài tập ✅ 2026-10-18\n',
    );
    const p = '2 Areas/Giải tích 1.md';
    expect(v.index.noteTags(p)).toEqual(['toán']);
    expect(v.index.outlinks(p).map((l) => [l.target, l.toPath])).toEqual([['Chưa có', null]]);
    expect(v.index.backlinks('2 Areas/Đại số.md')).toEqual([]);
    expect(
      v.index
        .allTasks()
        .filter((t) => t.path === p)
        .map((t) => [t.text, t.done, t.due]),
    ).toEqual([['Bài tập', true, null]]);
    expect(titles(v.index.search({ q: 'dao ham' }))).not.toContain('Giải tích 1');
    expect(titles(v.index.search({ q: 'tich phan' }))).toContain('Giải tích 1');
    expect(v.index.tags().map((t) => t.norm)).toEqual(['toán']);
    expect(v.index.getNote(p)?.revision).toBe((await v.vault.read(p)).revision);
  });

  it('is idempotent on revision', async () => {
    const before = v.index.getNote('2 Areas/Đại số.md');
    await v.index.updateFile('2 Areas/Đại số.md');
    await v.index.updateFile('2 Areas/Đại số.md');
    expect(v.index.getNote('2 Areas/Đại số.md')).toEqual(before);
  });

  it('a ghost link resolves the moment its target appears, and turns ghost again when it goes', async () => {
    expect(outlink('0 Inbox/Nháp.md', 'Chưa có')?.toPath).toBeNull();
    await v.put('1 Projects/Chưa có.md', 'Giờ đã có.\n');
    expect(outlink('0 Inbox/Nháp.md', 'Chưa có')?.toPath).toBe('1 Projects/Chưa có.md');
    expect(v.index.backlinks('1 Projects/Chưa có.md').map((b) => b.fromPath)).toEqual([
      '0 Inbox/Nháp.md',
    ]);
    v.removeFile('1 Projects/Chưa có.md');
    await v.index.removeFile('1 Projects/Chưa có.md');
    expect(outlink('0 Inbox/Nháp.md', 'Chưa có')?.toPath).toBeNull();
    expect(v.index.getNote('1 Projects/Chưa có.md')).toBeNull();
  });

  it('attachments are link targets too', async () => {
    expect(outlink('0 Inbox/Nháp.md', 'bảng.png')?.toPath).toBeNull();
    v.writeFile('Attachments/2026-10/bảng.png', Buffer.from([1, 2, 3]));
    await v.index.updateFile('Attachments/2026-10/bảng.png');
    expect(outlink('0 Inbox/Nháp.md', 'bảng.png')?.toPath).toBe('Attachments/2026-10/bảng.png');
    expect(v.index.backlinks('Attachments/2026-10/bảng.png')).toHaveLength(1);
    expect(v.index.getNote('Attachments/2026-10/bảng.png')).toBeNull();
  });

  it('a unique title becomes ambiguous when a duplicate appears, and unique again when it goes', async () => {
    expect(outlink('0 Inbox/Nháp.md', 'Bài 1')).toMatchObject({
      toPath: '2 Areas/Giải tích 1/Bài 1.md',
      ambiguous: false,
    });
    await v.put('2 Areas/Xác suất/Bài 1.md', 'Bài một của xác suất.\n');
    expect(outlink('0 Inbox/Nháp.md', 'Bài 1')).toMatchObject({ toPath: null, ambiguous: true });
    expect(v.index.linkingNotes('2 Areas/Giải tích 1/Bài 1.md')).toEqual([]);
    v.removeFile('2 Areas/Xác suất/Bài 1.md');
    await v.index.removeFile('2 Areas/Xác suất/Bài 1.md');
    expect(outlink('0 Inbox/Nháp.md', 'Bài 1')).toMatchObject({
      toPath: '2 Areas/Giải tích 1/Bài 1.md',
      ambiguous: false,
    });
  });

  it('renaming a note keeps its row, its outgoing links and its backlinks', async () => {
    const id = rowId('2 Areas/Giải tích 1.md');
    v.renameFile('2 Areas/Giải tích 1.md', '1 Projects/Giải tích một.md');
    await v.index.renameFile('2 Areas/Giải tích 1.md', '1 Projects/Giải tích một.md');
    expect(rowId('1 Projects/Giải tích một.md')).toBe(id);
    expect(v.index.getNote('2 Areas/Giải tích 1.md')).toBeNull();
    expect(v.index.getNote('1 Projects/Giải tích một.md')).toMatchObject({
      title: 'Giải tích một',
      folder: '1 Projects',
      class: 'user',
    });
    expect(v.index.backlinks('2 Areas/Đại số.md').map((b) => b.fromPath)).toEqual([
      '1 Projects/Giải tích một.md',
    ]);
    expect(v.index.noteTags('1 Projects/Giải tích một.md')).toEqual(['môn']);
    expect(v.index.search({ q: 'giai tich mot' })[0]).toMatchObject({
      title: 'Giải tích một',
      matchedIn: 'title',
    });
    expect(titles(v.index.search({ q: 'dao ham' }))).toEqual(['Giải tích một']);
  });

  it('moving a note re-resolves its own links (same-folder preference follows it)', async () => {
    await v.put('2 Areas/Xác suất/Bài 1.md', 'Bài một của xác suất.\n');
    await v.put('2 Areas/Xác suất/Tổng hợp.md', 'Xem [[Bài 1]].\n');
    expect(outlink('2 Areas/Xác suất/Tổng hợp.md', 'Bài 1')?.toPath).toBe(
      '2 Areas/Xác suất/Bài 1.md',
    );
    v.renameFile('2 Areas/Xác suất/Tổng hợp.md', '2 Areas/Giải tích 1/Tổng hợp.md');
    await v.index.renameFile('2 Areas/Xác suất/Tổng hợp.md', '2 Areas/Giải tích 1/Tổng hợp.md');
    expect(outlink('2 Areas/Giải tích 1/Tổng hợp.md', 'Bài 1')?.toPath).toBe(
      '2 Areas/Giải tích 1/Bài 1.md',
    );
  });

  it('a note moved into Templates leaves search; moved back it returns', async () => {
    v.renameFile('2 Areas/Đại số.md', 'Templates/Đại số.md');
    await v.index.renameFile('2 Areas/Đại số.md', 'Templates/Đại số.md');
    expect(v.index.search({ q: 'ma tran' })).toEqual([]);
    expect(v.index.getNote('Templates/Đại số.md')?.class).toBe('template');
    v.renameFile('Templates/Đại số.md', '2 Areas/Đại số.md');
    await v.index.renameFile('Templates/Đại số.md', '2 Areas/Đại số.md');
    expect(titles(v.index.search({ q: 'ma tran' }))).toEqual(['Đại số']);
  });

  it('reconcile picks up changes made while the app was closed, renames included', async () => {
    v.index.close();
    v.writeFile('0 Inbox/Mới.md', 'Ghi chú mới về xác suất.\n');
    v.removeFile('2 Areas/Đại số.md');
    v.renameFile('2 Areas/Giải tích 1/Bài 1.md', '2 Areas/Giải tích 1/Bài một.md');
    v.writeFile('2 Areas/Giải tích 1.md', 'Đã sửa khi app tắt.\n');
    const id = rowId('2 Areas/Giải tích 1/Bài 1.md');
    await v.reopen();
    expect(titles(v.index.search({ q: 'xac suat' }))).toContain('Mới');
    expect(v.index.getNote('2 Areas/Đại số.md')).toBeNull();
    expect(rowId('2 Areas/Giải tích 1/Bài một.md')).toBe(id);
    expect(titles(v.index.search({ q: 'da sua khi app tat' }))).toEqual(['Giải tích 1']);
  });

  it('serializes concurrent updates', async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        v.put(`0 Inbox/Ý ${i}.md`, `Nội dung số ${i} [[Ý ${(i + 1) % 20}]]\n`),
      ),
    );
    for (let i = 0; i < 20; i += 1)
      expect(outlink(`0 Inbox/Ý ${i}.md`, `Ý ${(i + 1) % 20}`)?.toPath).toBe(
        `0 Inbox/Ý ${(i + 1) % 20}.md`,
      );
  });
});
