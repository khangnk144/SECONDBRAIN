import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  chmodSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { atomicCreateFile } from '../../src/fs/atomic-write-file.js';
import {
  expectVaultError,
  openTempVault,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

describe('names, links and permissions on the way to the disk', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  it('names that only start with ".." are ordinary names inside the vault', async () => {
    await t.vault.create('..ghi chú.md', 'a');
    await t.vault.create('..Lưu trữ/a.md', 'b');
    mkdirSync(path.join(t.root, '..Lưu trữ', 'thư mục'));
    writeFileSync(path.join(t.root, '..Lưu trữ', 'thư mục', 'b.md'), 'ngoài');
    expect((await t.vault.read('..Lưu trữ/thư mục/b.md')).content).toBe('ngoài');
    const files = (await t.vault.list()).files.map((f) => f.path);
    expect(files).toEqual(
      expect.arrayContaining(['..ghi chú.md', '..Lưu trữ/a.md', '..Lưu trữ/thư mục/b.md']),
    );
  });

  it('results and events carry the on-disk spelling, not the request spelling', async () => {
    await t.vault.create('0 Inbox/x.md', 'x');
    symlinkSync(path.join(t.root, '0 Inbox'), path.join(t.root, 'lối tắt'), 'dir');
    const note = await t.vault.read('lối tắt/x.md');
    expect(note.path).toBe('0 Inbox/x.md');
    t.changes.length = 0;
    const written = await t.vault.write('lối tắt/x.md', 'y', note.revision);
    expect(written.path).toBe('0 Inbox/x.md');
    expect(t.changes).toEqual([expect.objectContaining({ kind: 'written', path: '0 Inbox/x.md' })]);
  });

  it.runIf(process.platform === 'win32')(
    'a case-variant request is reported in the disk case',
    async () => {
      await t.vault.create('0 Inbox/Ghi Chú.md', 'x');
      expect((await t.vault.read('0 inbox/ghi chú.md')).path).toBe('0 Inbox/Ghi Chú.md');
    },
  );

  it('writes, patches, renames and trash refuse a path that is a symlink', async () => {
    const target = await t.vault.create('0 Inbox/thật.md', 'thật');
    symlinkSync(
      path.join(t.root, '0 Inbox', 'thật.md'),
      path.join(t.root, '0 Inbox', 'liên kết.md'),
      'file',
    );
    const link = '0 Inbox/liên kết.md';
    const rev = target.revision;
    for (const op of [
      () => t.vault.write(link, 'x', rev),
      () => t.vault.patch(link, [{ start: 0, end: 1, text: 'T' }], rev),
      () => t.vault.rename(link, '0 Inbox/khác.md', { expectedRevision: rev, relink: false }),
      () => t.vault.trash([link], [rev]),
    ]) {
      const details = await expectVaultError(op(), 'VALIDATION');
      expect(details).toEqual({ path: link, reason: 'symlink' });
    }
    expect(lstatSync(path.join(t.root, link)).isSymbolicLink()).toBe(true);
    expect(readFileSync(path.join(t.root, '0 Inbox', 'thật.md'), 'utf8')).toBe('thật');
  });

  it.skipIf(process.platform === 'win32')('a replaced file keeps its permissions', async () => {
    const note = await t.vault.create('0 Inbox/riêng.md', 'a');
    const abs = path.join(t.root, '0 Inbox', 'riêng.md');
    chmodSync(abs, 0o640);
    await t.vault.write(note.path, 'b', note.revision);
    expect(statSync(abs).mode & 0o777).toBe(0o640);
  });

  it('create never replaces a file another program wrote in the meantime', async () => {
    const abs = path.join(t.root, '0 Inbox', 'đua.md');
    const vault = await t.reopen({
      failOperation: (op, p) => {
        if (op === 'write' && p === '0 Inbox/đua.md') writeFileSync(abs, 'chương trình khác');
        return undefined;
      },
    });
    await expectVaultError(vault.create('0 Inbox/đua.md', 'của app'), 'EXISTS');
    expect(readFileSync(abs, 'utf8')).toBe('chương trình khác');
    expect(readdirSync(path.join(t.root, '0 Inbox'))).toEqual(['đua.md']);
    const unique = await vault.createUnique('0 Inbox/đua.md', 'của app');
    expect(unique.path).toBe('0 Inbox/đua 2.md');
  });

  it('without hard links (FAT/exFAT) create falls back to check-then-rename', async () => {
    const noLinks = async () => {
      throw Object.assign(new Error('EPERM: no hard links'), { code: 'EPERM' });
    };
    const abs = path.join(t.root, '0 Inbox', 'usb.md');
    await atomicCreateFile(abs, 'mới', { hooks: { link: noLinks } });
    expect(readFileSync(abs, 'utf8')).toBe('mới');
    await expect(atomicCreateFile(abs, 'đè', { hooks: { link: noLinks } })).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(readFileSync(abs, 'utf8')).toBe('mới');
    expect(readdirSync(path.join(t.root, '0 Inbox'))).toEqual(['usb.md']);
    expect(sha256(readFileSync(abs))).toBe(sha256('mới'));
  });
});
