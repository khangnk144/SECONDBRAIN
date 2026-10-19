import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError } from '../../src/vault/vault-faults.js';
import { VaultError } from '../../src/vault/vault-types.js';
import { trashIds } from './helpers/folder-fixture.js';
import {
  expectVaultError,
  openTempVault,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

const NOTE = '0 Inbox/Ghi chú xung đột.md';
const DISK = '# Bản trên đĩa\r\nDòng của cửa sổ A\r\n';

describe('"keep mine": the disk version goes to the trash before the write (F3.6, SPEC §4.10)', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
    await t.vault.create(NOTE, DISK);
  });
  afterEach(() => t.cleanup());

  const trashFile = (id: string) =>
    readFileSync(
      path.join(t.root, '.secondbrain', 'trash', id, 'files', ...NOTE.split('/')),
      'utf8',
    );
  const trashMeta = (id: string) =>
    JSON.parse(readFileSync(path.join(t.root, '.secondbrain', 'trash', id, 'meta.json'), 'utf8'));

  it('stores the disk bytes with reason "conflict", then writes mine', async () => {
    const result = await t.vault.writeKeepingConflictCopy(NOTE, 'Bản của tôi\n', sha256(DISK));
    expect(result).toMatchObject({
      path: NOTE,
      revision: sha256('Bản của tôi\n'),
      trashId: expect.any(String),
    });
    expect(trashFile(result.trashId)).toBe(DISK);
    expect(trashMeta(result.trashId)).toMatchObject({ originalPaths: [NOTE], reason: 'conflict' });
    expect((await t.vault.read(NOTE)).content).toBe('Bản của tôi\n');
    expect((await t.vault.listTrash()).map((entry) => entry.reason)).toEqual(['conflict']);
  });

  it('refuses a stale revision (409) and creates no trash entry', async () => {
    const details = await expectVaultError(
      t.vault.writeKeepingConflictCopy(NOTE, 'mine', sha256('older')),
      'CONFLICT',
    );
    expect(details).toMatchObject({ currentRevision: sha256(DISK), currentContent: DISK });
    expect(trashIds(t.root)).toEqual([]);
  });

  it('a crash between the copy and the write leaves the note intact and one extra copy', async () => {
    const vault = await t.reopen({ crashBeforeRename: (p) => p === NOTE });
    await expect(vault.writeKeepingConflictCopy(NOTE, 'mine', sha256(DISK))).rejects.toThrow(
      SimulatedCrashError,
    );
    expect(readFileSync(path.join(t.root, ...NOTE.split('/')), 'utf8')).toBe(DISK);
    const [id] = trashIds(t.root);
    expect(trashFile(id!)).toBe(DISK);
  });
});

describe('patches computed at the revision', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
    await t.vault.create(NOTE, DISK);
  });
  afterEach(() => t.cleanup());

  it('applies what the planner returns on the exact bytes and reports the new content', async () => {
    const result = await t.vault.patchWith(NOTE, sha256(DISK), (content) => {
      expect(content).toBe(DISK);
      return [{ start: 2, end: 5, text: 'Bản' }];
    });
    expect(result.content).toBe(DISK);
    const changed = await t.vault.patchWith(NOTE, sha256(DISK), () => [
      { start: 0, end: 1, text: '##' },
    ]);
    expect(changed.content).toBe(`#${DISK}`);
    expect(changed.revision).toBe(sha256(`#${DISK}`));
  });

  it('writes nothing for no patches or a refusal, and checks the revision first', async () => {
    const file = path.join(t.root, ...NOTE.split('/'));
    const mtime = statSync(file).mtimeMs;
    expect((await t.vault.patchWith(NOTE, sha256(DISK), () => [])).revision).toBe(sha256(DISK));
    await expectVaultError(
      t.vault.patchWith(NOTE, sha256(DISK), () => {
        throw new VaultError('VALIDATION', 'no', { reason: 'test' });
      }),
      'VALIDATION',
    );
    await expectVaultError(
      t.vault.patchWith(NOTE, sha256('x'), () => []),
      'CONFLICT',
    );
    expect(statSync(file).mtimeMs).toBe(mtime);
    writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
    const details = await expectVaultError(
      t.vault.patchWith(NOTE, sha256(Buffer.from([0x63, 0x61, 0x66, 0xe9])), () => []),
      'VALIDATION',
    );
    expect(details.reason).toBe('not-utf8');
  });
});
