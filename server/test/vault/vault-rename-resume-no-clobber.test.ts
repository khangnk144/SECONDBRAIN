import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError, type VaultFaults } from '../../src/vault/vault-faults.js';
import type { VaultService } from '../../src/vault/vault-types.js';
import {
  expectVaultError,
  openTempVault,
  sha256,
  type TempVault,
} from './helpers/vault-test-kit.js';

const OLD = '0 Inbox/bài 1.md';
const NEW = '0 Inbox/Bài 1.md';
const NOTE = 'ghi chú gốc\n';
const OTHER = 'ghi chú mới gõ lại\n';

describe('resuming an interrupted rename never replaces another file', () => {
  let t: TempVault;
  const inbox = () => readdirSync(path.join(t.root, '0 Inbox')).sort();
  const disk = (name: string) => readFileSync(path.join(t.root, '0 Inbox', name), 'utf8');
  const parked = () => inbox().find((name) => name.endsWith('.renaming'));
  /** Crash on the n-th file move of the rename. */
  const crashOnMove = (n: number): VaultFaults => {
    let moves = 0;
    return {
      failOperation: (op) => {
        if (op === 'move' && ++moves === n) throw new SimulatedCrashError('mid rename');
        return undefined;
      },
    };
  };
  async function interruptedCaseRename(): Promise<{ vault: VaultService; id: string }> {
    const vault = await t.reopen(crashOnMove(2));
    const note = await vault.create(OLD, NOTE);
    await expect(
      vault.rename(OLD, NEW, { expectedRevision: note.revision, relink: false }),
    ).rejects.toThrow(SimulatedCrashError);
    const reopened = await t.reopen();
    const [pending] = await reopened.pendingJournal();
    return { vault: reopened, id: pending!.id };
  }
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(() => t.cleanup());

  it.each([NEW, OLD])('a note re-created as %j blocks both complete and undo', async (name) => {
    const { vault, id } = await interruptedCaseRename();
    expect(parked()).toMatch(/^\.sb-[0-9a-f]{12}\.renaming$/);
    await vault.create(name, OTHER);
    const before = inbox();
    for (const action of [() => vault.completeJournal(id), () => vault.undoJournal(id)]) {
      const details = await expectVaultError(action(), 'CONFLICT');
      expect(details.conflicts).toEqual([
        expect.objectContaining({ expectedRevision: null, currentRevision: sha256(OTHER) }),
      ]);
    }
    expect(inbox()).toEqual(before);
    expect(disk(path.basename(name))).toBe(OTHER);
    expect(disk(parked()!)).toBe(NOTE);
    // Once the user moves the new file away, the operation can finish.
    rmSync(path.join(t.root, name));
    await vault.completeJournal(id);
    expect(inbox()).toEqual(['Bài 1.md']);
    expect(disk('Bài 1.md')).toBe(NOTE);
  });

  it('a name taken between the two halves stops the rename and keeps it pending', async () => {
    let moves = 0;
    const vault = await t.reopen({
      failOperation: (op) => {
        // Another program writes the new name just before the first half runs.
        if (op === 'move' && ++moves === 1) writeFileSync(path.join(t.root, NEW), OTHER);
        return undefined;
      },
    });
    const note = await vault.create(OLD, NOTE);
    await expectVaultError(
      vault.rename(OLD, NEW, { expectedRevision: note.revision, relink: false }),
      'EXISTS',
    );
    expect(disk('Bài 1.md')).toBe(OTHER);
    expect(disk(parked()!)).toBe(NOTE);
    const [pending] = await vault.pendingJournal();
    expect(pending).toMatchObject({ status: 'failed' });
    rmSync(path.join(t.root, NEW));
    await (await t.reopen()).completeJournal(pending!.id);
    expect(disk('Bài 1.md')).toBe(NOTE);
  });

  it('completing a rename whose target is now taken names the target', async () => {
    const vault = await t.reopen(crashOnMove(1));
    const note = await vault.create('0 Inbox/a.md', NOTE);
    await expect(
      vault.rename('0 Inbox/a.md', '0 Inbox/b.md', {
        expectedRevision: note.revision,
        relink: false,
      }),
    ).rejects.toThrow(SimulatedCrashError);
    const reopened = await t.reopen();
    const [pending] = await reopened.pendingJournal();
    await reopened.create('0 Inbox/B.md', OTHER);
    const details = await expectVaultError(reopened.completeJournal(pending!.id), 'CONFLICT');
    expect(details).toEqual({
      journalId: pending!.id,
      conflicts: [{ path: '0 Inbox/b.md', expectedRevision: null, currentRevision: sha256(OTHER) }],
    });
    expect(inbox()).toEqual(['B.md', 'a.md']);
  });

  it('undoing a trash never lands on a case variant created since', async () => {
    const note = await t.vault.create('0 Inbox/a.md', NOTE);
    const { journalId } = await t.vault.trash([note.path], [note.revision]);
    await t.vault.create('0 Inbox/A.md', OTHER);
    const details = await expectVaultError(t.vault.undoJournal(journalId), 'CONFLICT');
    expect(details.conflicts).toEqual([
      { path: '0 Inbox/a.md', expectedRevision: null, currentRevision: sha256(OTHER) },
    ]);
    expect(inbox()).toEqual(['A.md']);
    expect(disk('A.md')).toBe(OTHER);
  });
});
