import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openVault } from '../../src/vault/open-vault.js';
import { createUlidGenerator } from '../../src/vault/ulid.js';
import { expectVaultError, openTempVault, type TempVault } from './helpers/vault-test-kit.js';

/** `rm` fails with the returned code for matching paths (a file held open on Windows). */
const failing = vi.hoisted(() => ({ rm: null as null | ((target: string) => string | undefined) }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const wrapped = {
    ...actual,
    rm: (target: string, options?: Parameters<typeof actual.rm>[1]) => {
      const code = failing.rm?.(String(target));
      if (code) return Promise.reject(Object.assign(new Error(`${code}: simulated`), { code }));
      return actual.rm(target, options);
    },
  };
  return { ...wrapped, default: wrapped };
});

describe('housekeeping is best effort and never stops the vault', () => {
  let t: TempVault;
  let warnings: string[];
  const reopen = async () => {
    await t.vault.close();
    t.vault = (
      await openVault({ root: t.root, onWarning: (message) => void warnings.push(message) })
    ).vault;
  };
  beforeEach(async () => {
    t = await openTempVault();
    warnings = [];
  });
  afterEach(async () => {
    failing.rm = null;
    await t.cleanup();
  });

  it('a leftover temp file that cannot be removed is reported, not fatal', async () => {
    const leftover = path.join(t.root, '0 Inbox', '.sb-0123456789ab.tmp');
    writeFileSync(leftover, 'x');
    failing.rm = (target) => (target.endsWith('.tmp') ? 'EBUSY' : undefined);
    await reopen();
    expect(existsSync(leftover)).toBe(true);
    expect(warnings).toEqual([expect.stringMatching(/temp files: 1 item\(s\) skipped \(EBUSY\)/)]);
  });

  it('an old trash entry that cannot be purged is reported and kept for next time', async () => {
    const note = await t.vault.create('0 Inbox/a.md', 'a');
    const { trashId } = await t.vault.trash([note.path], [note.revision]);
    await reopen();
    failing.rm = (target) => (target.includes(trashId) ? 'EPERM' : undefined);
    expect(await t.vault.purgeTrash(30, new Date('2099-01-01T00:00:00Z'))).toBe(0);
    expect(warnings).toEqual([expect.stringMatching(/purge old trash entries: 1 item.*EPERM/)]);
    expect((await t.vault.listTrash()).map((e) => e.id)).toEqual([trashId]);
    failing.rm = null;
    expect(await t.vault.purgeTrash(30, new Date('2099-01-01T00:00:00Z'))).toBe(1);
  });

  it('old finished journal entries are pruned best effort, orphan copy folders too', async () => {
    const note = await t.vault.create('0 Inbox/a.md', 'a');
    const { journalId } = await t.vault.rename(note.path, '0 Inbox/b.md', {
      expectedRevision: note.revision,
      relink: false,
    });
    const journalDir = path.join(t.root, '.secondbrain/state/journal');
    const file = path.join(journalDir, `${journalId}.json`);
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...entry, updatedAt: '2020-01-01T00:00:00.000Z' }));
    const oldOrphan = createUlidGenerator(() => new Date('2020-01-01T00:00:00Z'))();
    const newOrphan = createUlidGenerator()();
    for (const id of [oldOrphan, newOrphan]) {
      mkdirSync(path.join(journalDir, id, 'before'), { recursive: true });
      writeFileSync(path.join(journalDir, id, 'before', '0'), 'copy');
    }
    failing.rm = (target) => (target.includes(journalId) ? 'EBUSY' : undefined);
    await reopen();
    expect(warnings).toEqual([expect.stringMatching(/prune old journal entries: 1 item.*EBUSY/)]);
    expect(readdirSync(journalDir).sort()).toEqual([`${journalId}.json`, newOrphan].sort());
    failing.rm = null;
    warnings = [];
    await reopen();
    expect(readdirSync(journalDir)).toEqual([newOrphan]);
    expect(warnings).toEqual([]);
  });

  it('a throwing warning callback does not stop the open', async () => {
    writeFileSync(path.join(t.root, '0 Inbox', '.sb-0123456789ab.tmp'), 'x');
    failing.rm = () => 'EBUSY';
    await t.vault.close();
    const opened = await openVault({
      root: t.root,
      onWarning: () => {
        throw new Error('logger down');
      },
    });
    t.vault = opened.vault;
    expect(t.vault.id).toBeTruthy();
  });

  it('damaged journal and trash files are skipped, never acted on', async () => {
    const crashing = await t.reopen({ crashAfterJournalStep: () => true });
    const b = await crashing.create('0 Inbox/b.md', 'b');
    await expect(
      crashing.rename(b.path, '0 Inbox/c.md', { expectedRevision: b.revision, relink: false }),
    ).rejects.toThrow();
    await reopen();
    const [pending] = await t.vault.pendingJournal();
    const file = path.join(t.root, '.secondbrain/state/journal', `${pending!.id}.json`);
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    entry.steps[0].newPath = '../../ngoài kho.md';
    writeFileSync(file, JSON.stringify(entry));
    expect(await t.vault.pendingJournal()).toEqual([]);
    expect(warnings).toEqual([expect.stringMatching(/read journal entries: 1 item.*VALIDATION/)]);
    await expectVaultError(t.vault.completeJournal(pending!.id), 'VALIDATION');
    await expectVaultError(t.vault.undoJournal(pending!.id), 'VALIDATION');
    expect(readdirSync(path.join(t.root, '0 Inbox'))).toEqual(['c.md']);

    const a = await t.vault.create('0 Inbox/a.md', 'a');
    const { trashId } = await t.vault.trash([a.path], [a.revision]);
    const meta = path.join(t.root, '.secondbrain/trash', trashId, 'meta.json');
    const parsed = JSON.parse(readFileSync(meta, 'utf8'));
    writeFileSync(meta, JSON.stringify({ ...parsed, originalPaths: ['../x.md'] }));
    expect(await t.vault.listTrash()).toEqual([]);
    await expectVaultError(t.vault.restore(trashId), 'NOT_FOUND');
  });
});
