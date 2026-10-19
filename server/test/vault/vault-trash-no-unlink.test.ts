import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isAtomicTempName } from '../../src/fs/atomic-write-file.js';
import type { RelinkPlanner } from '../../src/vault/vault-types.js';
import { openTempVault, sha256, type TempVault } from './helpers/vault-test-kit.js';

const recorder = vi.hoisted(() => ({ removed: [] as string[] }));

// Every removal the vault code makes goes through these two functions.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped = {
    ...actual,
    unlink: (target: string, ...rest: []) => {
      recorder.removed.push(String(target));
      return actual.unlink(target, ...rest);
    },
    rm: (target: string, options?: Parameters<typeof actual.rm>[1]) => {
      recorder.removed.push(String(target));
      return actual.rm(target, options);
    },
  };
  return { ...wrapped, default: wrapped };
});

describe('nothing is unlinked outside the trash (F1.4)', () => {
  let t: TempVault;
  const outsideState = () => {
    const state = path.join(t.vault.root, '.secondbrain') + path.sep;
    // Our own temp names (removed after the content is in place) are not user files.
    return recorder.removed.filter(
      (p) => !p.startsWith(state) && !isAtomicTempName(path.basename(p)),
    );
  };
  beforeEach(async () => {
    t = await openTempVault();
    recorder.removed.length = 0;
  });
  afterEach(() => t.cleanup());

  it('trash, restore, undo and rename-with-relink only ever move user files', async () => {
    const a = await t.vault.create('1 Projects/Ghi chú.md', 'a [[b]]');
    const b = await t.vault.create('2 Areas/b.md', 'b');
    const planner: RelinkPlanner = {
      plan: async () => [{ path: a.path, expectedRevision: a.revision, newContent: 'a [[c]]' }],
    };
    t.vault.setRelinkPlanner(planner);
    const renamed = await t.vault.rename(b.path, '2 Areas/c.md', {
      expectedRevision: b.revision,
      relink: true,
    });
    await t.vault.undoJournal(renamed.journalId);
    const trashed = await t.vault.trash([a.path, b.path], [a.revision, b.revision]);
    const restored = await t.vault.restore(trashed.trashId);
    await t.vault.undoJournal(restored.journalId);
    await t.vault.restore(trashed.trashId);
    expect(outsideState()).toEqual([]);
  });

  it('the cross-volume fallback removes the source only after the copy is verified', async () => {
    const vault = await t.reopen({ failOperation: (op) => (op === 'move' ? 'EXDEV' : undefined) });
    recorder.removed.length = 0;
    const pdf = await vault.create('3 Resources/papers/x.pdf', new Uint8Array([1, 2, 3, 4]));
    const { trashId } = await vault.trash([pdf.path], [pdf.revision]);
    const source = path.join(vault.root, '3 Resources', 'papers', 'x.pdf');
    expect(outsideState()).toEqual([source]);
    const copy = path.join(
      vault.root,
      '.secondbrain/trash',
      trashId,
      'files/3 Resources/papers/x.pdf',
    );
    expect(sha256(readFileSync(copy))).toBe(pdf.revision);
  });
});
