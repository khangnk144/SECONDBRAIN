import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectVaultError,
  openTempVault,
  readDisk,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

describe('reads, creates and revisions', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  it('create then read returns the bytes and their SHA-256 revision', async () => {
    const content = '﻿# Đồ án\r\n\r\n- [ ] việc 1\r\n';
    const created = await t.vault.create('1 Projects/Đồ án Giải tích.md', content);
    const note = await t.vault.read('1 Projects/Đồ án Giải tích.md');
    expect(note.content).toBe(content);
    expect(note.revision).toBe(sha256(Buffer.from(content, 'utf8')));
    expect(created.revision).toBe(note.revision);
    expect(note.size).toBe(Buffer.byteLength(content));
    const bytes = await t.vault.readBytes('1 Projects/Đồ án Giải tích.md');
    expect(bytes.bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('create refuses an existing name, also as a case variant', async () => {
    await t.vault.create('0 Inbox/Ghi chú.md', 'a');
    await expectVaultError(t.vault.create('0 Inbox/Ghi chú.md', 'b'), 'EXISTS');
    await expectVaultError(t.vault.create('0 Inbox/GHI CHÚ.md', 'b'), 'EXISTS');
    await expectVaultError(t.vault.create('0 inbox/ghi chú.md', 'b'), 'EXISTS');
    await expectVaultError(t.vault.create('0 Inbox', 'b'), 'EXISTS');
    expect(readDisk(t.root, '0 Inbox/Ghi chú.md')).toBe('a');
  });

  it('create makes missing parent folders and reports them', async () => {
    await t.vault.create('2 Areas/Môn học/Giải tích 1/Bài 1.md', 'x');
    expect(t.changes.map((c) => [c.kind, c.path])).toEqual([
      ['folder-created', '2 Areas/Môn học'],
      ['folder-created', '2 Areas/Môn học/Giải tích 1'],
      ['created', '2 Areas/Môn học/Giải tích 1/Bài 1.md'],
    ]);
    expect(t.changes.every((c) => c.origin === 'app')).toBe(true);
  });

  it('createUnique appends " 2", " 3" before the extension', async () => {
    const a = await t.vault.createUnique('Attachments/Ảnh chụp.png', new Uint8Array([1]));
    const b = await t.vault.createUnique('Attachments/Ảnh chụp.png', new Uint8Array([2]));
    const c = await t.vault.createUnique('Attachments/ảnh chụp.png', new Uint8Array([3]));
    const d = await t.vault.createUnique('0 Inbox/README', 'x');
    const e = await t.vault.createUnique('0 Inbox/README', 'y');
    expect([a.path, b.path, c.path, d.path, e.path]).toEqual([
      'Attachments/Ảnh chụp.png',
      'Attachments/Ảnh chụp 2.png',
      'Attachments/ảnh chụp 3.png',
      '0 Inbox/README',
      '0 Inbox/README 2',
    ]);
  });

  it('createFolder creates nested folders and refuses existing ones', async () => {
    await t.vault.createFolder('2 Areas/Học kỳ 1/Tuần 3');
    expect(statSync(path.join(t.root, '2 Areas/Học kỳ 1/Tuần 3')).isDirectory()).toBe(true);
    await expectVaultError(t.vault.createFolder('2 areas'), 'EXISTS');
  });

  it('stat returns null for folders and missing files', async () => {
    await t.vault.create('a.md', 'abc');
    expect(await t.vault.stat('a.md')).toMatchObject({ path: 'a.md', size: 3 });
    expect(await t.vault.stat('0 Inbox')).toBeNull();
    expect(await t.vault.stat('missing.md')).toBeNull();
    await expectVaultError(t.vault.read('missing.md'), 'NOT_FOUND');
    await expectVaultError(t.vault.read('0 Inbox'), 'NOT_FOUND');
    expect(await t.vault.resolveExisting('a.md')).toBe(path.join(t.vault.root, 'a.md'));
  });

  it('list skips internal folders, git metadata and temp files, and includes empty folders', async () => {
    mkdirSync(path.join(t.root, '.git'));
    writeFileSync(path.join(t.root, '.git/HEAD'), 'ref');
    writeFileSync(path.join(t.root, '0 Inbox/.a.md.0123456789ab.tmp'), 'x');
    writeFileSync(path.join(t.root, '0 Inbox/.a.md.0123456789ab.renaming'), 'x');
    writeFileSync(path.join(t.root, '0 Inbox/a.md'), 'x');
    mkdirSync(path.join(t.root, '0 Inbox/trống'));
    const listing = await t.vault.list();
    const files = listing.files.map((f) => f.path);
    expect(files).toContain('0 Inbox/a.md');
    expect(files).toContain('CLAUDE.md');
    expect(files.some((f) => f.startsWith('.git') || f.startsWith('.secondbrain'))).toBe(false);
    expect(files.some((f) => f.includes('.tmp') || f.includes('.renaming'))).toBe(false);
    expect(listing.folders).toContain('0 Inbox/trống');
    expect(listing.folders).toContain('3 Resources/papers');
    expect(listing.folders.some((f) => f.startsWith('.'))).toBe(false);
  });
});
