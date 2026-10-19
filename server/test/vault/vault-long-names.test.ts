import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isAtomicTempName } from '../../src/fs/atomic-write-file.js';
import { isVaultTempFileName } from '../../src/vault/vault-layout.js';
import { expectVaultError, openTempVault, type TempVault } from './helpers/vault-test-kit.js';

/** 255 characters: the longest name the guard accepts (and a common file-system limit). */
const LONGEST = `${'a'.repeat(252)}.md`;

describe('names of the maximum length', () => {
  let t: TempVault;
  const inbox = () => readdirSync(path.join(t.root, '0 Inbox'));
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  it('can be created, saved and renamed (temp and interim names are short)', async () => {
    const created = await t.vault.create(`0 Inbox/${LONGEST}`, 'một');
    const written = await t.vault.write(created.path, 'hai', created.revision);
    const upper = `A${LONGEST.slice(1)}`;
    const renamed = await t.vault.rename(created.path, `0 Inbox/${upper}`, {
      expectedRevision: written.revision,
      relink: false,
    });
    expect(renamed.path).toBe(`0 Inbox/${upper}`);
    expect(inbox()).toEqual([upper]);
    // A file another program created with such a name is editable too.
    writeFileSync(path.join(t.root, '1 Projects', LONGEST), 'gốc');
    const outside = await t.vault.read(`1 Projects/${LONGEST}`);
    await t.vault.write(outside.path, 'mới', outside.revision);
  });

  it.skipIf(process.platform === 'win32')(
    'a name longer than the file system allows → WRITE_FAILED (ENAMETOOLONG)',
    async () => {
      // 156 characters but 260 UTF-8 bytes: accepted by the guard, refused by a 255-byte limit.
      const name = `${'Đồ án '.repeat(26)}.md`;
      expect(Buffer.byteLength(name)).toBeGreaterThan(255);
      const details = await expectVaultError(
        t.vault.create(`0 Inbox/${name}`, 'x'),
        'WRITE_FAILED',
      );
      expect(details).toEqual({ path: `0 Inbox/${name}`, cause: 'ENAMETOOLONG' });
      expect(inbox()).toEqual([]);
    },
  );

  it('temp names are recognised in both the short and the older long form', () => {
    expect(isAtomicTempName('.sb-0123456789ab.tmp')).toBe(true);
    expect(isAtomicTempName('.Ghi chú.md.0123456789ab.tmp')).toBe(true);
    expect(isAtomicTempName('.backup.tmp')).toBe(false);
    expect(isVaultTempFileName('.sb-0123456789ab.renaming')).toBe(true);
    expect(isVaultTempFileName('.bài 1.md.0123456789ab.renaming')).toBe(true);
    expect(isVaultTempFileName('Ghi chú.md')).toBe(false);
  });
});
