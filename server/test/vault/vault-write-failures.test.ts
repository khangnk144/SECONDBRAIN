import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError, type VaultFaults } from '../../src/vault/vault-faults.js';
import type { VaultService, WriteResult } from '../../src/vault/vault-types.js';
import {
  expectVaultError,
  openTempVault,
  readDisk,
  type TempVault,
} from './helpers/vault-test-kit.js';

const FILE = '1 Projects/Đồ án Giải tích.md';
const ORIGINAL = '# Đồ án\n\nbản gốc\n';

describe('disk-full and permission errors (F1.8)', () => {
  let t: TempVault;
  let original: WriteResult;
  const folder = () => readdirSync(path.join(t.root, '1 Projects'));
  beforeEach(async () => {
    t = await openTempVault();
    original = await t.vault.create(FILE, ORIGINAL);
  });
  afterEach(() => t.cleanup());

  async function failingWith(code: string, op: 'write' | 'move' = 'write'): Promise<VaultService> {
    const faults: VaultFaults = { failOperation: (o) => (o === op ? code : undefined) };
    const vault = await t.reopen(faults);
    t.changes.length = 0;
    return vault;
  }

  it.each(['ENOSPC', 'EACCES', 'EPERM', 'EROFS', 'EIO'])(
    '%s during a save → WRITE_FAILED with the path, original intact',
    async (code) => {
      const vault = await failingWith(code);
      const details = await expectVaultError(
        vault.write(FILE, 'mới', original.revision),
        'WRITE_FAILED',
      );
      expect(details).toEqual({ path: FILE, cause: code });
      expect(readDisk(t.root, FILE)).toBe(ORIGINAL);
      expect(folder()).toEqual(['Đồ án Giải tích.md']);
      expect(t.changes).toEqual([]);
    },
  );

  it('patch and create surface WRITE_FAILED the same way', async () => {
    const vault = await failingWith('ENOSPC');
    await expectVaultError(
      vault.patch(FILE, [{ start: 0, end: 1, text: '##' }], original.revision),
      'WRITE_FAILED',
    );
    const details = await expectVaultError(vault.create('0 Inbox/mới.md', 'x'), 'WRITE_FAILED');
    expect(details).toEqual({ path: '0 Inbox/mới.md', cause: 'ENOSPC' });
    expect(readdirSync(path.join(t.root, '0 Inbox'))).toEqual([]);
    expect(readDisk(t.root, FILE)).toBe(ORIGINAL);
  });

  it('permission denied while moving to the trash leaves the file where it was', async () => {
    const vault = await failingWith('EACCES', 'move');
    await expectVaultError(vault.trash([FILE], [original.revision]), 'WRITE_FAILED');
    expect(readDisk(t.root, FILE)).toBe(ORIGINAL);
    expect(await vault.pendingJournal()).toEqual([]);
  });
});

describe('crash between the temp write and the rename (F1.2)', () => {
  let t: TempVault;
  afterEach(() => t.cleanup());

  it('keeps the original; the leftover temp file is invisible and removed on the next open', async () => {
    t = await openTempVault();
    const original = await t.vault.create(FILE, ORIGINAL);
    const vault = await t.reopen({ crashBeforeRename: (p) => p === FILE });
    await expect(vault.write(FILE, 'mới '.repeat(10_000), original.revision)).rejects.toThrow(
      SimulatedCrashError,
    );
    const names = readdirSync(path.join(t.root, '1 Projects'));
    expect(names).toHaveLength(2);
    expect(names.some((n) => /^\.sb-[0-9a-f]{12}\.tmp$/.test(n))).toBe(true);
    expect(readDisk(t.root, FILE)).toBe(ORIGINAL);
    expect((await vault.list()).files.filter((f) => f.path.startsWith('1 Projects/'))).toHaveLength(
      1,
    );
    await t.reopen();
    expect(readdirSync(path.join(t.root, '1 Projects'))).toEqual(['Đồ án Giải tích.md']);
    expect((await t.vault.read(FILE)).revision).toBe(original.revision);
  });
});
