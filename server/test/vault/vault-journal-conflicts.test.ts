import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError } from '../../src/vault/vault-faults.js';
import {
  AFTER,
  AFTER_STATE,
  BEFORE,
  BEFORE_STATE,
  COURSE,
  createRelinkFixture,
  DAILY,
  OWN,
  stepCrash,
} from './helpers/relink-fixture.js';
import { expectVaultError, sha256 } from './helpers/vault-test-kit.js';

describe('journaled rename with relink: conflicts and rollback (F1.7)', () => {
  const f = createRelinkFixture();
  beforeEach(() => f.setup());
  afterEach(() => f.t.cleanup());

  it('"complete" refuses when a remaining file changed, and changes nothing', async () => {
    await expect(f.rename(await f.open(stepCrash(1)))).rejects.toThrow(SimulatedCrashError);
    const vault = await f.open();
    writeFileSync(path.join(f.t.root, DAILY), 'sửa ngoài\n');
    const before = f.snapshot();
    const [pending] = await vault.pendingJournal();
    const details = await expectVaultError(vault.completeJournal(pending!.id), 'CONFLICT');
    expect(details).toEqual({
      journalId: pending!.id,
      conflicts: [
        {
          path: DAILY,
          expectedRevision: sha256(BEFORE[DAILY]!),
          currentRevision: sha256('sửa ngoài\n'),
        },
      ],
    });
    expect(f.snapshot()).toEqual(before);
  });

  it('"undo" after a later edit → CONFLICT listing the file, nothing changed', async () => {
    const { journalId } = await f.rename(f.t.vault);
    const course = await f.t.vault.read(COURSE);
    await f.t.vault.write(COURSE, `${course.content}thêm\n`, course.revision);
    const before = f.snapshot();
    const details = await expectVaultError(f.t.vault.undoJournal(journalId), 'CONFLICT');
    expect(details.conflicts).toEqual([
      {
        path: COURSE,
        expectedRevision: sha256(AFTER[COURSE]!),
        currentRevision: sha256(`${AFTER[COURSE]}thêm\n`),
      },
    ]);
    expect(f.snapshot()).toEqual(before);
  });

  it('a stale f.planned edit is refused before anything is written', async () => {
    writeFileSync(path.join(f.t.root, COURSE), 'đã đổi\n');
    await expectVaultError(f.rename(f.t.vault), 'CONFLICT');
    expect(f.snapshot()).toEqual({ ...BEFORE_STATE, [COURSE]: 'đã đổi\n' });
    expect(readdirSync(path.join(f.t.root, '.secondbrain/state/journal'))).toEqual([]);
  });

  it('a step failing at runtime is rolled back automatically (status undone)', async () => {
    const vault = await f.open({
      failOperation: (op, p) => (op === 'write' && p === OWN ? 'EIO' : undefined),
    });
    const details = await expectVaultError(f.rename(vault), 'WRITE_FAILED');
    expect(details).toEqual({ path: OWN, cause: 'EIO' });
    expect(f.snapshot()).toEqual(BEFORE_STATE);
    expect(await vault.pendingJournal()).toEqual([]);
  });

  it('a failing rollback leaves the entry failed and pending; complete then finishes it', async () => {
    let courseWrites = 0;
    const vault = await f.open({
      failOperation: (op, p) => {
        if (op !== 'write') return undefined;
        if (p === DAILY) return 'ENOSPC';
        return p === COURSE && ++courseWrites === 2 ? 'EACCES' : undefined;
      },
    });
    await expectVaultError(f.rename(vault), 'WRITE_FAILED');
    const [pending] = await vault.pendingJournal();
    expect(pending).toMatchObject({ status: 'failed', appliedSteps: 1 });
    const healthy = await f.open();
    await healthy.completeJournal(pending!.id);
    expect(f.snapshot()).toEqual(AFTER_STATE);
  });

  it('rejects unknown ids, repeated undo and treats complete of a done entry as a no-op', async () => {
    await expectVaultError(f.t.vault.undoJournal('01J000000000000000000000ZZ'), 'NOT_FOUND');
    await expectVaultError(f.t.vault.completeJournal('../../vault'), 'NOT_FOUND');
    const { journalId } = await f.rename(f.t.vault);
    await f.t.vault.completeJournal(journalId);
    await f.t.vault.undoJournal(journalId);
    await expectVaultError(f.t.vault.undoJournal(journalId), 'VALIDATION');
    await expectVaultError(f.t.vault.completeJournal(journalId), 'VALIDATION');
  });
});
