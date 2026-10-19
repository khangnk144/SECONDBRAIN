import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isUlid } from '../../src/vault/ulid.js';
import {
  expectVaultError,
  listTree,
  openTempVault,
  readDisk,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

describe('trash and restore (F1.4)', () => {
  let t: TempVault;
  const trashDir = () => path.join(t.root, '.secondbrain/trash');
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  async function twoNotesNamedGhiChu() {
    const a = await t.vault.create('1 Projects/Ghi chú.md', 'dự án');
    const b = await t.vault.create('2 Areas/Ghi chú.md', 'môn học');
    return [a, b] as const;
  }

  it('moves files into trash/<ulid>/files with a meta.json, in one entry per call', async () => {
    const [a, b] = await twoNotesNamedGhiChu();
    const { journalId, trashId } = await t.vault.trash(
      [a.path, b.path],
      [a.revision, b.revision],
      'user',
    );
    expect(isUlid(trashId)).toBe(true);
    const entry = path.join(trashDir(), trashId);
    expect(listTree(entry)).toEqual([
      'files/',
      'files/1 Projects/',
      'files/1 Projects/Ghi chú.md',
      'files/2 Areas/',
      'files/2 Areas/Ghi chú.md',
      'meta.json',
    ]);
    const meta = JSON.parse(readFileSync(path.join(entry, 'meta.json'), 'utf8'));
    expect(meta).toEqual({
      opId: journalId,
      originalPaths: ['1 Projects/Ghi chú.md', '2 Areas/Ghi chú.md'],
      reason: 'user',
      deletedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
    expect(existsSync(path.join(t.root, '1 Projects/Ghi chú.md'))).toBe(false);
    expect(t.changes.filter((c) => c.kind === 'deleted').map((c) => c.path)).toEqual([
      a.path,
      b.path,
    ]);
    expect(await t.vault.listTrash()).toEqual([{ id: trashId, ...meta }]);
  });

  it('two files with the same base name trash and restore independently', async () => {
    const [a, b] = await twoNotesNamedGhiChu();
    const first = await t.vault.trash([a.path], [a.revision]);
    const second = await t.vault.trash([b.path], [b.revision]);
    const restoredB = await t.vault.restore(second.trashId);
    expect(restoredB.restored).toEqual([{ from: b.path, to: b.path }]);
    expect(readDisk(t.root, b.path)).toBe('môn học');
    expect(existsSync(path.join(t.root, a.path))).toBe(false);
    await t.vault.restore(first.trashId);
    expect(readDisk(t.root, a.path)).toBe('dự án');
    expect(readdirSync(trashDir())).toEqual([]);
    expect(
      t.changes
        .filter((c) => c.kind === 'created')
        .map((c) => c.path)
        .slice(-2),
    ).toEqual([b.path, a.path]);
  });

  it('a restore onto a taken name gets a " (restored)" suffix', async () => {
    const x = await t.vault.create('0 Inbox/x.md', 'cũ');
    const one = await t.vault.trash([x.path], [x.revision]);
    const y = await t.vault.create('0 Inbox/x.md', 'mới');
    const two = await t.vault.trash([y.path], [y.revision]);
    await t.vault.create('0 Inbox/X.md', 'mới nhất');
    expect((await t.vault.restore(one.trashId)).restored[0]!.to).toBe('0 Inbox/x (restored).md');
    expect((await t.vault.restore(two.trashId)).restored[0]!.to).toBe('0 Inbox/x (restored 2).md');
    expect(readDisk(t.root, '0 Inbox/x (restored).md')).toBe('cũ');
    expect(readDisk(t.root, '0 Inbox/x (restored 2).md')).toBe('mới');
    expect(readDisk(t.root, '0 Inbox/X.md')).toBe('mới nhất');
  });

  it('checks every revision before the first file moves', async () => {
    const [a, b] = await twoNotesNamedGhiChu();
    await expectVaultError(
      t.vault.trash([a.path, b.path], [a.revision, sha256('stale')]),
      'CONFLICT',
    );
    expect(readDisk(t.root, a.path)).toBe('dự án');
    expect(readdirSync(trashDir())).toEqual([]);
  });

  it('refuses empty, mismatched, duplicated and folder inputs', async () => {
    const [a] = await twoNotesNamedGhiChu();
    await expectVaultError(t.vault.trash([], []), 'VALIDATION');
    await expectVaultError(t.vault.trash([a.path], []), 'VALIDATION');
    const nfd = a.path.normalize('NFD');
    await expectVaultError(t.vault.trash([a.path, nfd], [a.revision, a.revision]), 'VALIDATION');
    await expectVaultError(t.vault.trash(['1 Projects'], [a.revision]), 'NOT_FOUND');
    await expectVaultError(t.vault.restore('01J000000000000000000000ZZ'), 'NOT_FOUND');
    await expectVaultError(t.vault.restore('../../x'), 'NOT_FOUND');
  });

  it('falls back to copy + verify + remove when the move crosses volumes (EXDEV)', async () => {
    const vault = await t.reopen({ failOperation: (op) => (op === 'move' ? 'EXDEV' : undefined) });
    const pdf = await vault.create(
      '3 Resources/papers/Bài báo.pdf',
      new Uint8Array([37, 80, 68, 70, 1, 2, 3]),
    );
    const { trashId } = await vault.trash([pdf.path], [pdf.revision]);
    expect(existsSync(path.join(t.root, pdf.path))).toBe(false);
    const trashed = readFileSync(path.join(trashDir(), trashId, 'files', pdf.path));
    expect(sha256(trashed)).toBe(pdf.revision);
    await vault.restore(trashId);
    expect(sha256(readFileSync(path.join(t.root, pdf.path)))).toBe(pdf.revision);
    expect(listTree(path.join(t.root, '3 Resources/papers'))).toEqual(['Bài báo.pdf']);
  });

  it('a failing cross-volume copy leaves the source intact and the operation undone', async () => {
    const vault = await t.reopen({
      failOperation: (op) => (op === 'move' ? 'EXDEV' : op === 'copy' ? 'ENOSPC' : undefined),
    });
    const note = await vault.create('0 Inbox/a.md', 'a');
    const details = await expectVaultError(
      vault.trash([note.path], [note.revision]),
      'WRITE_FAILED',
    );
    expect(details).toEqual({ path: note.path, cause: 'ENOSPC' });
    expect(readDisk(t.root, note.path)).toBe('a');
    expect(readdirSync(trashDir())).toEqual([]);
    expect(await vault.pendingJournal()).toEqual([]);
  });

  it('undo of a trash puts the files back; undo of a restore puts them back in the trash', async () => {
    const [a, b] = await twoNotesNamedGhiChu();
    const trashed = await t.vault.trash([a.path, b.path], [a.revision, b.revision]);
    await t.vault.undoJournal(trashed.journalId);
    expect(readDisk(t.root, a.path)).toBe('dự án');
    expect(readDisk(t.root, b.path)).toBe('môn học');
    expect(readdirSync(trashDir())).toEqual([]);

    const again = await t.vault.trash([a.path], [a.revision]);
    const restored = await t.vault.restore(again.trashId);
    await t.vault.undoJournal(restored.journalId);
    expect(existsSync(path.join(t.root, a.path))).toBe(false);
    expect((await t.vault.listTrash()).map((e) => e.id)).toEqual([again.trashId]);
    await expectVaultError(t.vault.undoJournal(restored.journalId), 'VALIDATION');
  });

  it('purgeTrash removes only old entries and keeps those an unfinished operation needs', async () => {
    const [a, b] = await twoNotesNamedGhiChu();
    const old = await t.vault.trash([a.path], [a.revision]);
    const metaFile = path.join(trashDir(), old.trashId, 'meta.json');
    const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
    writeFileSync(metaFile, JSON.stringify({ ...meta, deletedAt: '2026-01-01T00:00:00.000Z' }));
    const recent = await t.vault.trash([b.path], [b.revision]);
    expect(await t.vault.purgeTrash(30, new Date('2026-10-18T00:00:00Z'))).toBe(1);
    expect((await t.vault.listTrash()).map((e) => e.id)).toEqual([recent.trashId]);
    await expectVaultError(t.vault.purgeTrash(-1), 'VALIDATION');
  });
});
