import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  NEW,
  OWN,
  stepCrash,
} from './helpers/relink-fixture.js';
import { listTree, sha256 } from './helpers/vault-test-kit.js';

describe('journaled rename with relink: crash recovery (F1.7)', () => {
  const f = createRelinkFixture();
  beforeEach(() => f.setup());
  afterEach(() => f.t.cleanup());

  it('asks the planner before touching files, applies the edits, then renames', async () => {
    const result = await f.rename(f.t.vault);
    expect(f.planned).toEqual([
      { op: { kind: 'rename', from: OWN, to: NEW }, sourceStillThere: true },
    ]);
    expect(result).toEqual({
      journalId: expect.any(String),
      path: NEW,
      revision: sha256(AFTER[NEW]!),
      affected: [COURSE, DAILY],
    });
    expect(f.snapshot()).toEqual(AFTER_STATE);
    expect(f.t.changes.map((c) => [c.kind, c.path])).toEqual([
      ['written', COURSE],
      ['written', DAILY],
      ['written', OWN],
      ['renamed', NEW],
    ]);
    const entry = JSON.parse(
      readFileSync(
        path.join(f.t.root, '.secondbrain/state/journal', `${result.journalId}.json`),
        'utf8',
      ),
    );
    expect(entry.status).toBe('done');
    expect(entry.steps.map((s: { kind: string }) => s.kind)).toEqual([
      'write',
      'write',
      'write',
      'rename',
    ]);
    expect(await f.t.vault.pendingJournal()).toEqual([]);
  });

  describe.each([1, 2, 3, 4])('interrupted after step %i of 4', (k) => {
    async function crashThenReopen() {
      await expect(f.rename(await f.open(stepCrash(k)))).rejects.toThrow(SimulatedCrashError);
      const vault = await f.open();
      const pending = await vault.pendingJournal();
      expect(pending).toEqual([
        expect.objectContaining({
          op: 'rename',
          status: 'running',
          totalSteps: 4,
          appliedSteps: k,
        }),
      ]);
      expect(pending[0]!.paths).toEqual(expect.arrayContaining([OWN, NEW, COURSE, DAILY]));
      for (const p of [OWN, NEW, COURSE, DAILY]) expect(f.isBeforeOrAfter(p)).toBe(true);
      expect(listTree(f.t.root).some((p) => /\.(tmp|renaming)$/.test(p))).toBe(false);
      return { vault, id: pending[0]!.id };
    }

    it('"complete" finishes it', async () => {
      const { vault, id } = await crashThenReopen();
      await vault.completeJournal(id);
      expect(f.snapshot()).toEqual(AFTER_STATE);
      expect(await vault.pendingJournal()).toEqual([]);
    });

    it('"undo" restores every before copy', async () => {
      const { vault, id } = await crashThenReopen();
      await vault.undoJournal(id);
      expect(f.snapshot()).toEqual(BEFORE_STATE);
      expect(await vault.pendingJournal()).toEqual([]);
    });
  });

  it('an interrupted undo stays pending as "undoing" and can be resumed either way', async () => {
    for (const resume of ['undo', 'complete'] as const) {
      const { journalId } = await f.rename(await f.open());
      await expect(
        (await f.open({ crashAfterUndoStep: (_id, n) => n === 2 })).undoJournal(journalId),
      ).rejects.toThrow(SimulatedCrashError);
      const vault = await f.open();
      expect(await vault.pendingJournal()).toEqual([
        expect.objectContaining({ status: 'undoing' }),
      ]);
      if (resume === 'undo') {
        await vault.undoJournal(journalId);
        expect(f.snapshot()).toEqual(BEFORE_STATE);
      } else {
        await vault.completeJournal(journalId);
        expect(f.snapshot()).toEqual(AFTER_STATE);
        await vault.undoJournal(journalId);
      }
      expect(await vault.pendingJournal()).toEqual([]);
    }
  });

  it('a step applied but not yet recorded is recognised by its revision', async () => {
    await expect(f.rename(await f.open(stepCrash(2)))).rejects.toThrow(SimulatedCrashError);
    const dir = path.join(f.t.root, '.secondbrain/state/journal');
    const file = path.join(
      dir,
      readdirSync(dir).find((n) => n.endsWith('.json'))!,
    );
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    entry.steps[1].applied = false;
    writeFileSync(file, JSON.stringify(entry));
    const vault = await f.open();
    await vault.completeJournal(entry.id);
    expect(f.snapshot()).toEqual(AFTER_STATE);
  });

  it('without relink the rename is a single journaled step and the planner is not asked', async () => {
    const result = await f.t.vault.rename(OWN, NEW, {
      expectedRevision: sha256(BEFORE[OWN]!),
      relink: false,
    });
    expect(f.planned).toEqual([]);
    expect(result.affected).toEqual([]);
    expect(f.snapshot()).toEqual({ ...BEFORE_STATE, [OWN]: null, [NEW]: BEFORE[OWN] });
  });
});
