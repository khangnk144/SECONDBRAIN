import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError } from '../../src/vault/vault-faults.js';
import {
  expectVaultError,
  listTree,
  openTempVault,
  readDisk,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

const NFD_NAME = 'Bài tập Xác suất.md'.normalize('NFD');
const NFC_NAME = 'Bài tập Xác suất.md';

describe('Vietnamese, NFD and space-containing names (F1.6)', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  const inbox = () => readdirSync(path.join(t.root, '0 Inbox'));

  it('round-trips Vietnamese names with spaces', async () => {
    const file = '1 Projects/Đồ án Giải tích – nhóm 3.md';
    await t.vault.create(file, 'nội dung');
    expect((await t.vault.read(file)).content).toBe('nội dung');
    expect((await t.vault.list()).files.map((f) => f.path)).toContain(file);
  });

  it('reads and writes an NFD-named file through its NFC path without duplicating it', async () => {
    writeFileSync(path.join(t.root, '0 Inbox', NFD_NAME), 'từ macOS');
    expect(NFD_NAME).not.toBe(NFC_NAME);
    expect((await t.vault.list()).files.map((f) => f.path)).toContain(`0 Inbox/${NFC_NAME}`);
    const note = await t.vault.read(`0 Inbox/${NFC_NAME}`);
    expect(note.path).toBe(`0 Inbox/${NFC_NAME}`);
    await t.vault.write(`0 Inbox/${NFC_NAME}`, 'đã sửa', note.revision);
    expect(inbox()).toEqual([NFD_NAME]);
    expect(readDisk(t.root, `0 Inbox/${NFD_NAME}`)).toBe('đã sửa');
    // An NFD path given to the API means the same file.
    expect((await t.vault.read(`0 Inbox/${NFD_NAME}`)).content).toBe('đã sửa');
    await expectVaultError(t.vault.create(`0 Inbox/${NFC_NAME}`, 'x'), 'EXISTS');
  });

  it('case-only rename bài 1.md → Bài 1.md succeeds in two steps', async () => {
    const created = await t.vault.create('0 Inbox/bài 1.md', 'một');
    const result = await t.vault.rename('0 Inbox/bài 1.md', '0 Inbox/Bài 1.md', {
      expectedRevision: created.revision,
      relink: false,
    });
    expect(result).toMatchObject({
      path: '0 Inbox/Bài 1.md',
      revision: created.revision,
      affected: [],
    });
    expect(inbox()).toEqual(['Bài 1.md']);
    expect(t.changes.at(-1)).toMatchObject({
      kind: 'renamed',
      path: '0 Inbox/Bài 1.md',
      oldPath: '0 Inbox/bài 1.md',
    });
    expect(await t.vault.pendingJournal()).toEqual([]);
  });

  it('an NFC-only rename rewrites the on-disk name in NFC', async () => {
    writeFileSync(path.join(t.root, '0 Inbox', NFD_NAME), 'x');
    await t.vault.rename(`0 Inbox/${NFC_NAME}`, `0 Inbox/${NFC_NAME}`, {
      expectedRevision: sha256('x'),
      relink: false,
    });
    expect(inbox()).toEqual([NFC_NAME]);
  });

  it('renaming onto an existing name (or its case variant) → EXISTS', async () => {
    const a = await t.vault.create('0 Inbox/a.md', 'a');
    await t.vault.create('0 Inbox/b.md', 'b');
    const opts = { expectedRevision: a.revision, relink: false };
    await expectVaultError(t.vault.rename('0 Inbox/a.md', '0 Inbox/b.md', opts), 'EXISTS');
    await expectVaultError(t.vault.rename('0 Inbox/a.md', '0 Inbox/B.md', opts), 'EXISTS');
    await expectVaultError(t.vault.rename('0 Inbox/a.md', '0 Inbox/a.md', opts), 'VALIDATION');
    expect(inbox().sort()).toEqual(['a.md', 'b.md']);
  });

  it('rename and move create missing folders inside the vault', async () => {
    const a = await t.vault.create('0 Inbox/Ghi chú.md', 'a');
    const moved = await t.vault.move('0 Inbox/Ghi chú.md', '2 Areas/Môn mới', {
      expectedRevision: a.revision,
      relink: false,
    });
    expect(moved.path).toBe('2 Areas/Môn mới/Ghi chú.md');
    const renamed = await t.vault.rename(moved.path, 'Ghi chú gốc.md', {
      expectedRevision: a.revision,
      relink: false,
    });
    expect(renamed.path).toBe('Ghi chú gốc.md');
    expect(listTree(t.root)).toContain('2 Areas/Môn mới/');
    expect(readDisk(t.root, 'Ghi chú gốc.md')).toBe('a');
  });

  it('a failure between the two halves of a case-only rename is rolled back', async () => {
    let moves = 0;
    const vault = await t.reopen({
      failOperation: (op) => (op === 'move' && ++moves === 2 ? 'EIO' : undefined),
    });
    const created = await vault.create('0 Inbox/bài 2.md', 'hai');
    await expectVaultError(
      vault.rename('0 Inbox/bài 2.md', '0 Inbox/Bài 2.md', {
        expectedRevision: created.revision,
        relink: false,
      }),
      'WRITE_FAILED',
    );
    expect(inbox()).toEqual(['bài 2.md']);
    expect(await vault.pendingJournal()).toEqual([]);
  });

  it('a crash between the two halves is finished by completeJournal or reverted by undo', async () => {
    for (const action of ['complete', 'undo'] as const) {
      let moves = 0;
      const vault = await t.reopen({
        failOperation: (op) => {
          if (op === 'move' && ++moves === 2) throw new SimulatedCrashError('mid rename');
          return undefined;
        },
      });
      const created = await vault.create(`0 Inbox/bài ${action}.md`, action);
      await expect(
        vault.rename(`0 Inbox/bài ${action}.md`, `0 Inbox/Bài ${action}.md`, {
          expectedRevision: created.revision,
          relink: false,
        }),
      ).rejects.toThrow(SimulatedCrashError);
      expect(inbox().some((name) => name.endsWith('.renaming'))).toBe(true);
      const reopened = await t.reopen();
      const [pending] = await reopened.pendingJournal();
      expect(pending).toMatchObject({ op: 'rename', status: 'running', appliedSteps: 0 });
      if (action === 'complete') await reopened.completeJournal(pending!.id);
      else await reopened.undoJournal(pending!.id);
      const expected = action === 'complete' ? `Bài ${action}.md` : `bài ${action}.md`;
      expect(inbox()).toContain(expected);
      expect(inbox().some((name) => name.endsWith('.renaming'))).toBe(false);
      expect(await reopened.pendingJournal()).toEqual([]);
    }
  });
});
