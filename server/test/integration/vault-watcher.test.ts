import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VaultChange } from '../../src/vault/vault-types.js';
import {
  isIgnoredVaultEntry,
  startVaultWatcher,
  type VaultWatcher,
} from '../../src/vault/vault-watcher.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

async function waitFor<T>(probe: () => T | undefined, timeoutMs = 1000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for a watcher event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('vault watcher reports outside edits within 1 s (F1.3)', () => {
  let root: string;
  let watcher: VaultWatcher;
  let changes: VaultChange[];
  const known = new Map<string, string>();

  beforeEach(async () => {
    root = makeTempDir('sb watcher Kho ghi chú');
    mkdirSync(path.join(root, '.secondbrain', 'cache'), { recursive: true });
    mkdirSync(path.join(root, '.git'));
    mkdirSync(path.join(root, '1 Projects'));
    changes = [];
    known.clear();
    watcher = startVaultWatcher({
      root,
      onChange: (change) => {
        changes.push(change);
        if ('revision' in change) known.set(change.path, change.revision);
      },
      onError: (error) => {
        throw error;
      },
      knownRevision: (p) => known.get(p) ?? null,
      stabilityMs: 100,
    });
    await watcher.ready;
  });

  afterEach(async () => {
    await watcher.close();
    removeDir(root);
  });

  const find = (predicate: (change: VaultChange) => boolean) => () => changes.find(predicate);

  it('reports a new file, then an edit, with the revision of the bytes on disk', async () => {
    const started = Date.now();
    writeFileSync(path.join(root, '1 Projects', 'Đồ án mới.md'), '# Đồ án\n');
    const created = await waitFor(find((c) => c.kind === 'created'));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(created).toEqual({
      kind: 'created',
      path: '1 Projects/Đồ án mới.md',
      revision: sha('# Đồ án\n'),
      origin: 'external',
    });
    writeFileSync(path.join(root, '1 Projects', 'Đồ án mới.md'), '# Đồ án\nthêm\n');
    const written = await waitFor(find((c) => c.kind === 'written'));
    expect(written).toMatchObject({
      path: '1 Projects/Đồ án mới.md',
      revision: sha('# Đồ án\nthêm\n'),
    });
  });

  it('pairs a deletion with a creation of the same bytes into one rename, also across folders', async () => {
    writeFileSync(path.join(root, 'Bài 1.md'), 'nội dung');
    await waitFor(find((c) => c.kind === 'created'));
    mkdirSync(path.join(root, '2 Areas'));
    renameSync(path.join(root, 'Bài 1.md'), path.join(root, '2 Areas', 'Bài 1.md'));
    const renamed = await waitFor(find((c) => c.kind === 'renamed'));
    expect(renamed).toMatchObject({ path: '2 Areas/Bài 1.md', oldPath: 'Bài 1.md' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(changes.filter((c) => c.kind === 'deleted' || c.kind === 'created')).toHaveLength(1);
  });

  it('reports a deletion after the rename window and folders as folder events', async () => {
    writeFileSync(path.join(root, 'xoá tôi.md'), 'x');
    await waitFor(find((c) => c.kind === 'created'));
    rmSync(path.join(root, 'xoá tôi.md'));
    expect(await waitFor(find((c) => c.kind === 'deleted'))).toMatchObject({ path: 'xoá tôi.md' });
    mkdirSync(path.join(root, 'Thư mục mới'));
    expect(await waitFor(find((c) => c.kind === 'folder-created'))).toMatchObject({
      path: 'Thư mục mới',
    });
    rmSync(path.join(root, 'Thư mục mới'), { recursive: true });
    expect(await waitFor(find((c) => c.kind === 'folder-deleted'))).toMatchObject({
      path: 'Thư mục mới',
    });
  });

  it('reports NFD file names (macOS copies) in NFC', async () => {
    writeFileSync(path.join(root, 'Giải tích.md'.normalize('NFD')), 'a');
    const created = await waitFor(find((c) => c.kind === 'created'));
    expect(created.path).toBe('Giải tích.md'.normalize('NFC'));
  });

  it('reports names that merely start with ".." (they are inside the vault)', async () => {
    mkdirSync(path.join(root, '..Lưu trữ'));
    writeFileSync(path.join(root, '..Lưu trữ', 'a.md'), 'a');
    writeFileSync(path.join(root, '..ghi chú.md'), 'b');
    await waitFor(() => (changes.length >= 3 ? true : undefined));
    expect(changes.map((c) => `${c.kind} ${c.path}`).sort()).toEqual([
      'created ..Lưu trữ/a.md',
      'created ..ghi chú.md',
      'folder-created ..Lưu trữ',
    ]);
  });

  it('ignores app state, git internals and editor temp files', async () => {
    writeFileSync(path.join(root, '.secondbrain', 'cache', 'index.sqlite'), 'db');
    writeFileSync(path.join(root, '.git', 'HEAD'), 'ref');
    writeFileSync(path.join(root, '.Bài 1.md.0123456789ab.tmp'), 'temp');
    writeFileSync(path.join(root, '.Bài 1.md.swp'), 'swap');
    writeFileSync(path.join(root, '~$báo cáo.docx'), 'lock');
    writeFileSync(path.join(root, 'thật.md'), 'real');
    await waitFor(find((c) => c.kind === 'created'));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changes.map((c) => c.path)).toEqual(['thật.md']);
  });
});

describe('watcher ignore rules', () => {
  it.each([
    ['.secondbrain/state/events.jsonl', true],
    ['.SecondBrain/vault.json', true],
    ['.git/index', true],
    ['notes/.ghi chú.md.a1b2c3d4e5f6.tmp', true],
    ['notes/.ghi chú.md.a1b2c3d4e5f6.renaming', true],
    ['notes/.#Bài 1.md', true],
    ['notes/Bài 1.md~', true],
    ['wiki/.git/x', false],
    ['1 Projects/Đồ án.md', false],
    ['.obsidian/app.json', false],
  ])('%s → ignored %s', (relativePath, ignored) => {
    expect(isIgnoredVaultEntry(relativePath)).toBe(ignored);
  });
});
