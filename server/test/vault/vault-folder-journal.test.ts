import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SimulatedCrashError } from '../../src/vault/vault-faults.js';
import {
  AFTER_STATE,
  BEFORE,
  BEFORE_STATE,
  createFolderFixture,
  DOC,
  FOLDER,
  IMAGE,
  INSIDE,
  MOVED,
  OUTSIDE,
  stepCrash,
} from './helpers/folder-fixture.js';
import { expectVaultError, listTree, sha256 } from './helpers/vault-test-kit.js';

describe('folder rename: journaled, relinked, recoverable (F2.2)', () => {
  const f = createFolderFixture();
  beforeEach(() => f.setup());
  afterEach(() => f.t.cleanup());

  it('moves the folder first, then rewrites the links at the new paths', async () => {
    const result = await f.t.vault.renameFolder(FOLDER, MOVED, { relink: true });
    expect(result).toEqual({
      journalId: expect.any(String),
      path: MOVED,
      affected: [OUTSIDE, INSIDE],
    });
    expect(f.planned).toEqual([
      [
        [INSIDE, `${MOVED}/Ghi chú dự án.md`],
        [DOC, `${MOVED}/Tài liệu.md`],
        [IMAGE, `${MOVED}/hình/ảnh 1.png`],
      ],
    ]);
    expect(f.snapshot()).toEqual(AFTER_STATE());
    const entry = JSON.parse(
      readFileSync(
        path.join(f.t.root, '.secondbrain/state/journal', `${result.journalId}.json`),
        'utf8',
      ),
    );
    expect(entry).toMatchObject({ op: 'folder-rename', status: 'done' });
    expect(entry.steps.map((s: { kind: string; path: string }) => [s.kind, s.path])).toEqual([
      ['folder-rename', FOLDER],
      ['write', OUTSIDE],
      ['write', `${MOVED}/Ghi chú dự án.md`],
    ]);
    const kinds = f.t.changes.map((c) => `${c.kind} ${c.path}`);
    expect(kinds).toContain(`renamed ${MOVED}/hình/ảnh 1.png`);
    expect(kinds).toContain(`folder-created ${MOVED}/rỗng`);
    expect(kinds).toContain(`folder-deleted ${FOLDER}`);
    expect(kinds.slice(-2)).toEqual([`written ${OUTSIDE}`, `written ${MOVED}/Ghi chú dự án.md`]);
    expect(f.t.changes.find((c) => c.kind === 'renamed' && c.path.endsWith('Tài liệu.md'))).toEqual(
      expect.objectContaining({ oldPath: DOC, revision: sha256(BEFORE[DOC]!) }),
    );
  });

  it('a dry run lists the notes it would rewrite and changes nothing', async () => {
    const before = listTree(f.t.root);
    const preview = await f.t.vault.previewRenameFolder(FOLDER, MOVED, { relink: true });
    expect(preview).toEqual({ dryRun: true, path: MOVED, affected: [OUTSIDE, INSIDE] });
    expect(listTree(f.t.root)).toEqual(before);
    expect(f.t.changes).toEqual([]);
  });

  describe.each([1, 2, 3])('interrupted after step %i of 3', (k) => {
    async function crashThenReopen() {
      await expect(
        (await f.open(stepCrash(k))).renameFolder(FOLDER, MOVED, { relink: true }),
      ).rejects.toThrow(SimulatedCrashError);
      const vault = await f.open();
      const pending = await vault.pendingJournal();
      expect(pending).toEqual([
        expect.objectContaining({
          op: 'folder-rename',
          status: 'running',
          appliedSteps: k,
          totalSteps: 3,
        }),
      ]);
      expect(listTree(f.t.root).some((p) => /\.(tmp|renaming)\/?$/.test(p))).toBe(false);
      return { vault, id: pending[0]!.id };
    }

    it('"complete" finishes it', async () => {
      const { vault, id } = await crashThenReopen();
      await vault.completeJournal(id);
      expect(f.snapshot()).toEqual(AFTER_STATE());
      expect(await vault.pendingJournal()).toEqual([]);
    });

    it('"undo" puts every file and folder back', async () => {
      const { vault, id } = await crashThenReopen();
      await vault.undoJournal(id);
      expect(f.snapshot()).toEqual(BEFORE_STATE());
      expect(await vault.pendingJournal()).toEqual([]);
    });
  });

  it('a crash before the folder step leaves a journal that "complete" can still finish', async () => {
    const { journalId } = await f.t.vault.renameFolder(FOLDER, MOVED, { relink: true });
    await f.t.vault.undoJournal(journalId);
    const file = path.join(f.t.root, '.secondbrain/state/journal', `${journalId}.json`);
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    writeFileSync(file, JSON.stringify({ ...entry, status: 'running' }));
    const vault = await f.open();
    await vault.completeJournal(journalId);
    expect(f.snapshot()).toEqual(AFTER_STATE());
  });

  it('undo after a relinked note was edited again stops with a conflict and changes nothing (F20.2)', async () => {
    const { journalId } = await f.t.vault.renameFolder(FOLDER, MOVED, { relink: true });
    const edited = await f.t.vault.read(OUTSIDE);
    await f.t.vault.write(OUTSIDE, `${edited.content}thêm\n`, edited.revision);
    const state = f.snapshot();
    const details = await expectVaultError(f.t.vault.undoJournal(journalId), 'CONFLICT');
    expect(details.conflicts).toEqual([expect.objectContaining({ path: OUTSIDE })]);
    expect(f.snapshot()).toEqual(state);
  });

  it('a case-only rename goes through an interim name and needs no relink', async () => {
    const result = await f.t.vault.renameFolder(FOLDER, '1 Projects/ĐỒ ÁN CŨ', { relink: true });
    expect(result).toMatchObject({ path: '1 Projects/ĐỒ ÁN CŨ', affected: [] });
    expect(f.planned).toEqual([]);
    expect(listTree(path.join(f.t.root, '1 Projects'))).toContain('ĐỒ ÁN CŨ/Tài liệu.md');
    await f.t.vault.undoJournal(result.journalId);
    expect(f.snapshot()).toEqual(BEFORE_STATE());
  });

  it('refuses standard folders, a target inside the source, an existing target and a missing folder', async () => {
    for (const standard of ['0 Inbox', '3 Resources/papers', 'wiki/concepts', 'daily']) {
      const details = await expectVaultError(
        f.t.vault.renameFolder(standard, '1 Projects/x', { relink: true }),
        'FORBIDDEN',
      );
      expect(details.reason).toBe('standard-folder');
      await expectVaultError(f.t.vault.trashFolder(standard), 'FORBIDDEN');
    }
    const inside = await expectVaultError(
      f.t.vault.renameFolder(FOLDER, `${FOLDER}/bên trong`, { relink: true }),
      'VALIDATION',
    );
    expect(inside.reason).toBe('inside-source');
    await expectVaultError(f.t.vault.renameFolder(FOLDER, '2 Areas', { relink: true }), 'EXISTS');
    await expectVaultError(
      f.t.vault.renameFolder('1 Projects/Không có', 'x', { relink: true }),
      'NOT_FOUND',
    );
    await expectVaultError(f.t.vault.trashFolder(INSIDE), 'NOT_FOUND');
    expect(f.snapshot()).toEqual(BEFORE_STATE());
  });
});
