import { readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectVaultError,
  openTempVault,
  readDisk,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

describe('writes and patches check the revision', () => {
  let t: TempVault;
  let base: string;
  const file = '1 Projects/Đồ án.md';
  beforeEach(async () => {
    t = await openTempVault();
    base = (await t.vault.create(file, 'dòng 1\r\ndòng 2\r\n')).revision;
  });
  afterEach(() => t.cleanup());

  it('write replaces the content at the expected revision', async () => {
    const result = await t.vault.write(file, 'mới\r\n', base);
    expect(result.revision).toBe(sha256('mới\r\n'));
    expect(readDisk(t.root, file)).toBe('mới\r\n');
    expect(t.changes.at(-1)).toMatchObject({
      kind: 'written',
      path: file,
      revision: result.revision,
    });
  });

  it('stale revision → CONFLICT with the current revision and content, nothing written', async () => {
    writeFileSync(path.join(t.root, file), 'sửa ngoài');
    const details = await expectVaultError(t.vault.write(file, 'của tôi', base), 'CONFLICT');
    expect(details).toEqual({
      path: file,
      currentRevision: sha256('sửa ngoài'),
      currentContent: 'sửa ngoài',
    });
    expect(readDisk(t.root, file)).toBe('sửa ngoài');
  });

  it('a deleted file → CONFLICT with currentRevision null', async () => {
    rmSync(path.join(t.root, file));
    const details = await expectVaultError(t.vault.write(file, 'x', base), 'CONFLICT');
    expect(details).toEqual({ path: file, currentRevision: null });
  });

  it('a binary file in conflict reports no content', async () => {
    const created = await t.vault.create('Attachments/a.bin', new Uint8Array([0xff, 0xfe, 0x00]));
    writeFileSync(path.join(t.root, 'Attachments/a.bin'), Buffer.from([0xc3, 0x28]));
    const details = await expectVaultError(
      t.vault.write('Attachments/a.bin', 'x', created.revision),
      'CONFLICT',
    );
    expect(details).not.toHaveProperty('currentContent');
  });

  it('writing identical content does not touch the file', async () => {
    const before = statSync(path.join(t.root, file)).mtimeMs;
    const count = t.changes.length;
    const result = await t.vault.write(file, 'dòng 1\r\ndòng 2\r\n', base);
    expect(result.revision).toBe(base);
    expect(statSync(path.join(t.root, file)).mtimeMs).toBe(before);
    expect(t.changes.length).toBe(count);
  });

  it('two writers with the same base: the second gets CONFLICT', async () => {
    const results = await Promise.allSettled([
      t.vault.write(file, 'A', base),
      t.vault.write(file, 'B', base),
    ]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(readDisk(t.root, file)).toBe('A');
  });

  it('patch replaces only the given ranges, in any order', async () => {
    const result = await t.vault.patch(
      file,
      [
        { start: 14, end: 14, text: ' – xong' },
        { start: 0, end: 6, text: 'Dòng một' },
      ],
      base,
    );
    expect(readDisk(t.root, file)).toBe('Dòng một\r\ndòng 2 – xong\r\n');
    expect(result.revision).toBe(sha256('Dòng một\r\ndòng 2 – xong\r\n'));
  });

  it.each([
    [
      'overlapping ranges',
      [
        { start: 0, end: 4, text: 'a' },
        { start: 3, end: 6, text: 'b' },
      ],
    ],
    [
      'two patches at the same offset',
      [
        { start: 2, end: 2, text: 'a' },
        { start: 2, end: 4, text: 'b' },
      ],
    ],
    ['a range past the end', [{ start: 0, end: 99, text: 'a' }]],
    ['a negative start', [{ start: -1, end: 2, text: 'a' }]],
    ['start after end', [{ start: 4, end: 2, text: 'a' }]],
    ['no patches', []],
  ])('patch refuses %s with VALIDATION and writes nothing', async (_label, patches) => {
    await expectVaultError(t.vault.patch(file, patches, base), 'VALIDATION');
    expect(readDisk(t.root, file)).toBe('dòng 1\r\ndòng 2\r\n');
  });

  it('patch refuses a range that splits an emoji, and non-UTF-8 files', async () => {
    const emoji = await t.vault.create('0 Inbox/e.md', 'a📅b');
    await expectVaultError(
      t.vault.patch('0 Inbox/e.md', [{ start: 2, end: 2, text: 'x' }], emoji.revision),
      'VALIDATION',
    );
    const bin = await t.vault.create('0 Inbox/b.md', new Uint8Array([0xc3, 0x28]));
    await expectVaultError(
      t.vault.patch('0 Inbox/b.md', [{ start: 0, end: 0, text: 'x' }], bin.revision),
      'VALIDATION',
    );
  });

  it('patch with a stale revision → CONFLICT', async () => {
    await t.vault.write(file, 'khác', base);
    const details = await expectVaultError(
      t.vault.patch(file, [{ start: 0, end: 1, text: 'x' }], base),
      'CONFLICT',
    );
    expect(details.currentRevision).toBe(sha256('khác'));
  });

  it('rename, move and trash with a stale revision → CONFLICT and nothing moves', async () => {
    const stale = sha256('old');
    const opts = { expectedRevision: stale, relink: false };
    await expectVaultError(t.vault.rename(file, '1 Projects/Mới.md', opts), 'CONFLICT');
    await expectVaultError(t.vault.move(file, '4 Archive', opts), 'CONFLICT');
    await expectVaultError(t.vault.trash([file], [stale]), 'CONFLICT');
    expect(readDisk(t.root, file)).toBe('dòng 1\r\ndòng 2\r\n');
    expect(readdirSync(path.join(t.root, '.secondbrain/state/journal'))).toEqual([]);
  });

  it('listeners can unsubscribe, and a throwing listener does not fail the write', async () => {
    const seen: string[] = [];
    const off = t.vault.onChange((c) => seen.push(c.kind));
    t.vault.onChange(() => {
      throw new Error('listener bug');
    });
    const next = await t.vault.write(file, 'x', base);
    off();
    await t.vault.write(file, 'y', next.revision);
    expect(seen).toEqual(['written']);
  });

  it('close waits for queued writes; later calls fail', async () => {
    const pending = t.vault.write(file, 'cuối', base);
    await t.vault.close();
    await pending;
    expect(readDisk(t.root, file)).toBe('cuối');
    await expect(t.vault.read(file)).rejects.toThrow(/closed/);
    await expect(t.vault.create('0 Inbox/z.md', 'z')).rejects.toThrow(/closed/);
  });
});
