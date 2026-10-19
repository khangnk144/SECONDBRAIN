import Database from 'better-sqlite3';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RebuildProgress, SearchResult } from '../../src/index/index-types.js';
import { gateVaultReads } from './helpers/gated-vault.js';
import {
  createIndexedVault,
  fixtureFiles,
  titles,
  type IndexedVault,
} from './helpers/index-test-vault.js';

let v: IndexedVault;
beforeEach(async () => {
  v = await createIndexedVault({ files: fixtureFiles('search-vault') });
});
afterEach(() => v.cleanup());

const dbFile = () => path.join(v.vault.paths.cacheDir, 'index.sqlite');
const QUERIES = [
  'giai tich',
  'dai so',
  'do an',
  'tich phan',
  'ma tran',
  'tag:đồ-án',
  'folder:"1 Projects"',
  'fourier',
  'moi them',
  'doi ten',
  '',
];
const snapshot = (): Record<string, SearchResult[]> =>
  Object.fromEntries(QUERIES.map((q) => [q, v.index.search({ q })]));

describe('rebuild on open', () => {
  it('rebuilds a corrupt index file', async () => {
    v.index.close();
    writeFileSync(dbFile(), 'this is not a database, just garbage bytes '.repeat(200));
    writeFileSync(`${dbFile()}-wal`, 'stale wal');
    const index = await v.reopen();
    expect(await index.open()).toEqual({ rebuilt: true, reason: 'corrupt' });
    expect(titles(index.search({ q: 'giai tich' }))).toContain('Giải tích 1');
    expect(existsSync(`${dbFile()}.building`)).toBe(false);
  });

  it('rebuilds a database whose pages are damaged', async () => {
    v.index.close();
    const bytes = readFileSync(dbFile());
    // Keep the header, overwrite the rest: the file opens but its pages fail the check.
    bytes.fill(0x5a, 200);
    writeFileSync(dbFile(), bytes);
    const index = await v.reopen();
    expect((await index.open()).rebuilt).toBe(true);
    expect(titles(index.search({ q: 'dai so' }))).toContain('Đại số tuyến tính');
  });

  it('rebuilds when the schema version differs', async () => {
    v.index.close();
    const db = new Database(dbFile());
    db.prepare("UPDATE meta SET value = '0' WHERE key = 'schema_version'").run();
    db.close();
    const index = await v.reopen();
    expect(await index.open()).toEqual({ rebuilt: true, reason: 'schema' });
    expect(titles(index.search({ q: 'do an' })).length).toBeGreaterThan(0);
  });

  it('reuses a healthy index without rebuilding', async () => {
    const index = await v.reopen();
    expect(await index.open()).toEqual({ rebuilt: false, reason: null });
  });
});

describe('rebuild and swap', () => {
  it('reports progress phases in order', async () => {
    const phases: RebuildProgress['phase'][] = [];
    await v.index.rebuild((p) => {
      if (phases[phases.length - 1] !== p.phase) phases.push(p.phase);
    });
    expect(phases).toEqual(['scan', 'index', 'swap', 'done']);
    expect(v.index.isRebuilding()).toBe(false);
  });

  it('answers searches from the old index during a rebuild and applies queued edits after the swap', async () => {
    const gated = gateVaultReads(v.vault);
    const index = await v.reopen({ vault: gated.vault });
    gated.close();
    const waiting = gated.waiting();
    const rebuild = index.rebuild();
    await waiting;
    expect(index.isRebuilding()).toBe(true);
    expect(index.rebuild()).toBe(rebuild);

    v.writeFile('0 Inbox/Mới thêm.md', 'Ghi chú mới thêm trong lúc xây lại.\n');
    const created = index.updateFile('0 Inbox/Mới thêm.md');
    v.removeFile('2 Areas/Đại số tuyến tính.md');
    const removed = index.removeFile('2 Areas/Đại số tuyến tính.md');
    // The old index still answers, without the queued changes.
    expect(titles(index.search({ q: 'dai so' }))).toContain('Đại số tuyến tính');
    expect(index.search({ q: 'moi them' })).toEqual([]);

    gated.open();
    await Promise.all([rebuild, created, removed]);
    expect(index.isRebuilding()).toBe(false);
    expect(titles(index.search({ q: 'moi them' }))).toEqual(['Mới thêm']);
    expect(titles(index.search({ q: 'dai so tuyen tinh' }))).not.toContain('Đại số tuyến tính');
    expect(index.getNote('2 Areas/Đại số tuyến tính.md')).toBeNull();
  });

  it('a closed service abandons a running rebuild and leaves no building file behind', async () => {
    const gated = gateVaultReads(v.vault);
    const index = await v.reopen({ vault: gated.vault });
    gated.close();
    const waiting = gated.waiting();
    const rebuild = index.rebuild();
    await waiting;
    index.close();
    gated.open();
    await rebuild;
    expect(existsSync(`${dbFile()}.building`)).toBe(false);
  });
});

describe('rebuild equality (F8.5)', () => {
  it('create, edit, delete and rename a note, then rebuild: identical results and snippets', async () => {
    await v.put('0 Inbox/Mới thêm.md', 'Ghi chú mới thêm về ma trận và giải tích. #đồ-án\n');
    await v.put(
      '2 Areas/Giải tích 1.md',
      '---\ntags: [môn]\n---\nĐã sửa: tích phân bội và [[Đại số tuyến tính]].\n',
    );
    v.removeFile('1 Projects/Đồ án Xác suất.md');
    await v.index.removeFile('1 Projects/Đồ án Xác suất.md');
    v.renameFile('0 Inbox/Ý tưởng.md', '1 Projects/Đổi tên ý tưởng.md');
    await v.index.renameFile('0 Inbox/Ý tưởng.md', '1 Projects/Đổi tên ý tưởng.md');

    const before = snapshot();
    const backlinksBefore = v.index.backlinks('2 Areas/Đại số tuyến tính.md');
    const tagsBefore = v.index.tags();
    expect(titles(before['moi them'] ?? [])).toEqual(['Mới thêm']);
    expect(titles(before['doi ten'] ?? [])).toEqual(['Đổi tên ý tưởng']);

    await v.index.rebuild();
    expect(snapshot()).toEqual(before);
    expect(v.index.backlinks('2 Areas/Đại số tuyến tính.md')).toEqual(backlinksBefore);
    expect(v.index.tags()).toEqual(tagsBefore);
  });
});
