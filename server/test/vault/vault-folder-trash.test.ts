import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError } from '../../src/vault/vault-faults.js';
import {
  BEFORE,
  BEFORE_STATE,
  createFolderFixture,
  DOC,
  FOLDER,
  IMAGE,
  INSIDE,
  OUTSIDE,
  stepCrash,
  trashIds,
} from './helpers/folder-fixture.js';
import { expectVaultError, listTree } from './helpers/vault-test-kit.js';

const FILES = [INSIDE, DOC, IMAGE];
const ONLY_OUTSIDE = { [OUTSIDE]: BEFORE[OUTSIDE]! };

describe('folder trash: one entry, never unlinked, recoverable (F2.2, SPEC §4.11)', () => {
  const f = createFolderFixture();
  beforeEach(() => f.setup());
  afterEach(() => f.t.cleanup());

  function trashedLayout(trashId: string) {
    const dir = path.join(f.t.root, '.secondbrain', 'trash', trashId);
    return {
      meta: JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')),
      files: listTree(path.join(dir, 'files')),
    };
  }

  it('moves everything below the folder into one trash entry keeping the structure', async () => {
    const result = await f.t.vault.trashFolder(FOLDER);
    expect(result).toEqual({
      journalId: expect.any(String),
      trashId: expect.any(String),
      paths: [INSIDE, DOC, IMAGE].sort(),
    });
    expect(trashIds(f.t.root)).toEqual([result.trashId]);
    const { meta, files } = trashedLayout(result.trashId);
    expect(meta).toMatchObject({ opId: result.journalId, reason: 'user' });
    expect([...meta.originalPaths].sort()).toEqual([...FILES].sort());
    for (const file of FILES) expect(files).toContain(file);
    expect(files).toContain(`${FOLDER}/rỗng/`);
    expect(f.snapshot()).toEqual(ONLY_OUTSIDE);
    const kinds = f.t.changes.map((c) => `${c.kind} ${c.path}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        `deleted ${IMAGE}`,
        `folder-deleted ${FOLDER}/hình`,
        `folder-deleted ${FOLDER}`,
      ]),
    );
  });

  it('undo re-creates the folder with its empty subfolder and drops the trash entry', async () => {
    const { journalId } = await f.t.vault.trashFolder(FOLDER);
    f.t.changes.length = 0;
    await f.t.vault.undoJournal(journalId);
    expect(f.snapshot()).toEqual(BEFORE_STATE());
    expect(trashIds(f.t.root)).toEqual([]);
    expect(f.t.changes.map((c) => `${c.kind} ${c.path}`)).toEqual(
      expect.arrayContaining([`folder-created ${FOLDER}/rỗng`, `created ${INSIDE}`]),
    );
  });

  it('restore of the trash entry brings the files and every folder back, empty ones too', async () => {
    const { trashId } = await f.t.vault.trashFolder(FOLDER);
    const { restored } = await f.t.vault.restore(trashId);
    expect(restored.map((r) => r.to).sort()).toEqual([...FILES].sort());
    expect(f.snapshot()).toEqual(BEFORE_STATE());
    expect(trashIds(f.t.root)).toEqual([]);
  });

  it('interrupted after its step: reported, then "complete" or "undo" either way', async () => {
    for (const resume of ['complete', 'undo'] as const) {
      await expect((await f.open(stepCrash(1))).trashFolder(FOLDER)).rejects.toThrow(
        SimulatedCrashError,
      );
      const vault = await f.open();
      const [pending] = await vault.pendingJournal();
      expect(pending).toMatchObject({ op: 'folder-trash', appliedSteps: 1, totalSteps: 1 });
      if (resume === 'complete') {
        await vault.completeJournal(pending!.id);
        expect(f.snapshot()).toEqual(ONLY_OUTSIDE);
      }
      await vault.undoJournal(pending!.id);
      expect(f.snapshot()).toEqual(BEFORE_STATE());
      expect(await vault.pendingJournal()).toEqual([]);
    }
  });

  it('across volumes (EXDEV) the files are copied, verified and the folder still moves whole', async () => {
    const vault = await f.open({ failOperation: (op) => (op === 'move' ? 'EXDEV' : undefined) });
    const { trashId, journalId } = await vault.trashFolder(FOLDER);
    expect(f.snapshot()).toEqual(ONLY_OUTSIDE);
    expect(trashedLayout(trashId).files).toEqual(
      expect.arrayContaining([...FILES, `${FOLDER}/rỗng/`]),
    );
    await vault.undoJournal(journalId);
    expect(f.snapshot()).toEqual(BEFORE_STATE());
  });

  it('a copy failing midway rolls everything back and reports WRITE_FAILED', async () => {
    const vault = await f.open({
      failOperation: (op, p) =>
        op === 'move' ? 'EXDEV' : op === 'copy' && p === IMAGE ? 'EIO' : undefined,
    });
    const details = await expectVaultError(vault.trashFolder(FOLDER), 'WRITE_FAILED');
    expect(details).toMatchObject({ path: IMAGE, cause: 'EIO' });
    expect(f.snapshot()).toEqual(BEFORE_STATE());
    expect(await vault.pendingJournal()).toEqual([]);
    expect(trashIds(f.t.root)).toEqual([]);
  });

  it('an empty folder goes to the trash under its own name; undo and restore re-create it', async () => {
    const empty = path.join(f.t.root, ...FOLDER.split('/'), 'rỗng');
    const { trashId, journalId, paths } = await f.t.vault.trashFolder(`${FOLDER}/rỗng`);
    expect(paths).toEqual([]);
    expect(trashedLayout(trashId).meta).toMatchObject({
      originalPaths: [`${FOLDER}/rỗng`],
      folders: [`${FOLDER}/rỗng`],
    });
    expect(existsSync(empty)).toBe(false);
    await f.t.vault.undoJournal(journalId);
    expect(existsSync(empty)).toBe(true);
    const again = await f.t.vault.trashFolder(`${FOLDER}/rỗng`);
    expect(await f.t.vault.restore(again.trashId)).toEqual({
      journalId: expect.any(String),
      restored: [],
    });
    expect(existsSync(empty)).toBe(true);
    expect(trashIds(f.t.root)).toEqual([]);
  });

  it('refuses a symlinked folder and a file path', async () => {
    symlinkSync(
      path.join(f.t.root, ...FOLDER.split('/')),
      path.join(f.t.root, '2 Areas', 'lối tắt'),
      'dir',
    );
    const linked = await expectVaultError(f.t.vault.trashFolder('2 Areas/lối tắt'), 'VALIDATION');
    expect(linked.reason).toBe('symlink');
    await expectVaultError(
      f.t.vault.renameFolder('2 Areas/lối tắt', '2 Areas/khác', { relink: true }),
      'VALIDATION',
    );
    await expectVaultError(f.t.vault.trashFolder(OUTSIDE), 'NOT_FOUND');
    expect(existsSync(path.join(f.t.root, ...FOLDER.split('/'), 'Tài liệu.md'))).toBe(true);
  });
});
