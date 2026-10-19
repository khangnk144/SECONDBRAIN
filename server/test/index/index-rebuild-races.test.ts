import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openIndex } from '../../src/index/open-index.js';
import { gateVaultReads } from './helpers/gated-vault.js';
import { indexState } from './helpers/index-state.js';
import { createIndexedVault, type IndexedVault } from './helpers/index-test-vault.js';

const LINKER = '0 Inbox/Nối.md';
let v: IndexedVault;
beforeEach(async () => {
  v = await createIndexedVault({
    files: {
      '2 Areas/Đích.md': 'Đích đến cuối cùng.\n',
      [LINKER]: 'Xem [[Đích]], [[Tên cũ]] và [[Mới tạo]].\n',
      '0 Inbox/Tên cũ.md': 'Bản ghi tên cũ.\n',
      '1 Projects/Sửa.md': 'Bản đầu về ma trận.\n',
    },
  });
});
afterEach(() => v.cleanup());

const dbFile = () => path.join(v.vault.paths.cacheDir, 'index.sqlite');
const targets = (index = v.index) =>
  index.outlinks(LINKER).map((l) => [l.target, l.toPath, l.ambiguous]);

/** The file changes every race test makes while the rebuild is reading. */
function changeFilesOnDisk(): void {
  v.removeFile('2 Areas/Đích.md');
  v.renameFile('0 Inbox/Tên cũ.md', '0 Inbox/Tên mới.md');
  v.writeFile('0 Inbox/Mới tạo.md', 'Mới tạo trong lúc xây lại.\n');
  v.writeFile('1 Projects/Sửa.md', 'Bản hai về định thức, xem [[Tên mới]].\n');
}

const EXPECTED_LINKS = [
  ['Đích', null, false],
  ['Tên cũ', null, false],
  ['Mới tạo', '0 Inbox/Mới tạo.md', false],
];

describe('changes racing a rebuild leave the same index as a clean build (F8.5)', () => {
  it('explicit rebuild with deletes, renames, creates and edits reported meanwhile', async () => {
    const gated = gateVaultReads(v.vault);
    const index = await v.reopen({ vault: gated.vault });
    gated.close();
    const waiting = gated.waiting();
    const rebuild = index.rebuild();
    await waiting;
    changeFilesOnDisk();
    // Reported the way the watcher reports them; they wait behind the rebuild.
    const queued = [
      index.removeFile('2 Areas/Đích.md'),
      index.renameFile('0 Inbox/Tên cũ.md', '0 Inbox/Tên mới.md'),
      index.updateFile('0 Inbox/Mới tạo.md'),
      index.updateFile('1 Projects/Sửa.md'),
    ];
    gated.open();
    await Promise.all([rebuild, ...queued]);

    expect(targets(index)).toEqual(EXPECTED_LINKS);
    expect(index.getNote('2 Areas/Đích.md')).toBeNull();
    expect(index.backlinks('2 Areas/Đích.md')).toEqual([]);
    expect(index.linkCatalog().notePaths.has('2 Areas/Đích.md')).toBe(false);
    expect(index.outlinks('1 Projects/Sửa.md')[0]?.toPath).toBe('0 Inbox/Tên mới.md');
    const raced = indexState(index);
    await index.rebuild();
    expect(indexState(index)).toEqual(raced);
    expect(indexState(await v.reopen())).toEqual(raced);
  });

  it('open-time rebuild of a corrupt index while files change before the watcher runs', async () => {
    v.index.close();
    writeFileSync(dbFile(), 'garbage '.repeat(100));
    const gated = gateVaultReads(v.vault);
    gated.close();
    const waiting = gated.waiting();
    const opening = openIndex({ vault: gated.vault });
    await waiting;
    changeFilesOnDisk();
    gated.open();
    const index = await opening;
    try {
      expect(await index.open()).toEqual({ rebuilt: true, reason: 'corrupt' });
      expect(targets(index)).toEqual(EXPECTED_LINKS);
      expect(index.getNote('0 Inbox/Tên mới.md')?.title).toBe('Tên mới');
      const raced = indexState(index);
      await index.rebuild();
      expect(indexState(index)).toEqual(raced);
    } finally {
      index.close();
    }
    expect(targets(await v.reopen())).toEqual(EXPECTED_LINKS);
  });

  it('reconcile repairs links an older index left pointing at a missing file', async () => {
    v.index.close();
    const db = new Database(dbFile());
    db.prepare("UPDATE links SET to_path = '2 Areas/Đã mất.md' WHERE target_raw = 'Mới tạo'").run();
    db.close();
    const index = await v.reopen();
    expect(index.outlinks(LINKER).find((l) => l.target === 'Mới tạo')?.toPath).toBeNull();
    expect(index.backlinks('2 Areas/Đã mất.md')).toEqual([]);
  });
});
