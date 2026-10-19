import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realPath } from '../../src/fs/real-path.js';
import { readFileState, readIfFile } from '../../src/vault/vault-file-state.js';
import { expectVaultError, openTempVault, type TempVault } from './helpers/vault-test-kit.js';

/** Per-call failures injected into fs/promises: return an errno code to fail that call. */
const failing = vi.hoisted(() => ({
  open: null as null | ((target: string) => string | undefined),
  readFile: null as null | ((target: string) => string | undefined),
  realpath: null as null | ((target: string) => string | undefined),
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const fail = (code: string) =>
    Promise.reject(Object.assign(new Error(`${code}: simulated`), { code }));
  const wrapped = {
    ...actual,
    open: (target: string, ...rest: [string?, number?]) => {
      const code = failing.open?.(String(target));
      return code ? fail(code) : actual.open(target, ...rest);
    },
    readFile: (target: string, ...rest: []) => {
      const code = failing.readFile?.(String(target));
      return code ? fail(code) : actual.readFile(target, ...rest);
    },
    realpath: (target: string) => {
      const code = failing.realpath?.(String(target));
      return code ? fail(code) : actual.realpath(target);
    },
  };
  return { ...wrapped, default: wrapped };
});

describe('disk errors of the vault state and of reads', () => {
  let t: TempVault;
  beforeEach(async () => {
    t = await openTempVault();
  });
  afterEach(async () => {
    failing.open = failing.readFile = failing.realpath = null;
    await t.cleanup();
  });

  it('a journal that cannot be saved → WRITE_FAILED before any note is touched', async () => {
    const note = await t.vault.create('0 Inbox/a.md', 'a');
    failing.open = (target) => (target.includes(`state${path.sep}journal`) ? 'ENOSPC' : undefined);
    const details = await expectVaultError(
      t.vault.rename(note.path, '0 Inbox/b.md', { expectedRevision: note.revision, relink: false }),
      'WRITE_FAILED',
    );
    expect(details).toEqual({
      path: expect.stringMatching(/^\.secondbrain\/state\/journal\//),
      cause: 'ENOSPC',
    });
    expect(readdirSync(path.join(t.root, '0 Inbox'))).toEqual(['a.md']);
  });

  it('a trash meta.json that cannot be written → WRITE_FAILED and the file stays', async () => {
    const note = await t.vault.create('0 Inbox/a.md', 'a');
    failing.open = (target) =>
      target.includes(`${path.sep}trash${path.sep}`) ? 'EACCES' : undefined;
    const details = await expectVaultError(
      t.vault.trash([note.path], [note.revision]),
      'WRITE_FAILED',
    );
    expect(details.path).toMatch(/^\.secondbrain\/trash\/[0-9A-Z]{26}\/meta\.json$/);
    expect(readFileSync(path.join(t.root, '0 Inbox/a.md'), 'utf8')).toBe('a');
    expect(await t.vault.pendingJournal()).toEqual([]);
  });

  it('read errors other than "missing" propagate instead of looking like a deleted file', async () => {
    const note = await t.vault.create('0 Inbox/a.md', 'a');
    const abs = path.join(t.vault.root, '0 Inbox', 'a.md');
    expect(await readIfFile(path.join(t.vault.root, 'missing.md'))).toBeNull();
    expect(await readIfFile(path.join(t.vault.root, '0 Inbox'))).toBeNull();
    failing.readFile = (target) => (target === abs ? 'EIO' : undefined);
    await expect(readIfFile(abs)).rejects.toMatchObject({ code: 'EIO' });
    await expect(
      t.vault.rename(note.path, '0 Inbox/b.md', { expectedRevision: note.revision, relink: false }),
    ).rejects.toMatchObject({ code: 'EIO' });
    await expect(t.vault.trash([note.path], [note.revision])).rejects.toMatchObject({
      code: 'EIO',
    });
  });

  it('files above the large-file limit are hashed as a stream, not held in memory', async () => {
    const abs = path.join(t.vault.root, 'Attachments', 'big.bin');
    const bytes = Buffer.alloc(64 * 1024, 7);
    writeFileSync(abs, bytes);
    failing.readFile = (target) => (target === abs ? 'ENOMEM' : undefined);
    const state = await readFileState(abs, 1024);
    expect(state).toEqual({
      revision: createHash('sha256').update(bytes).digest('hex'),
      bytes: null,
    });
  });

  it('realpath falls back to the JavaScript implementation when the native call fails', async () => {
    failing.realpath = () => 'EISDIR';
    expect(await realPath(t.vault.root)).toBe(t.vault.root);
    await expect(realPath(path.join(t.vault.root, 'missing'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const note = await t.vault.create('0 Inbox/qua ổ ảo.md', 'x');
    expect((await t.vault.read(note.path)).content).toBe('x');
  });
});
