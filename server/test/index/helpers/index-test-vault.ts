/**
 * Temp vaults for index tests: real `openVault` + real `openIndex` on a folder whose path has
 * spaces and Vietnamese letters. Files are written with `fs` directly, the way an outside editor
 * would, and the test tells the index about each change (there is no watcher here).
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openIndex, type OpenIndexOptions } from '../../../src/index/open-index.js';
import type { IndexService } from '../../../src/index/index-types.js';
import { openVault } from '../../../src/vault/open-vault.js';
import type { VaultService } from '../../../src/vault/vault-types.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';

export interface Clock {
  now: () => Date;
  set: (instant: Date) => void;
}

/** A settable clock; `new Date(y, m, d, h, min)` is local time, as the app's dates are. */
export function makeClock(start: Date): Clock {
  let current = start;
  return { now: () => new Date(current.getTime()), set: (instant) => (current = instant) };
}

export interface IndexedVault {
  base: string;
  root: string;
  vault: VaultService;
  index: IndexService;
  /** Writes a file directly on disk (outside-editor style). */
  writeFile: (vaultPath: string, content: string | Buffer) => void;
  removeFile: (vaultPath: string) => void;
  renameFile: (from: string, to: string) => void;
  /** Writes and tells the index (await = the index reflects the change). */
  put: (vaultPath: string, content: string) => Promise<void>;
  reopen: (options?: Partial<OpenIndexOptions>) => Promise<IndexService>;
  cleanup: () => Promise<void>;
}

export interface IndexedVaultOptions extends Partial<OpenIndexOptions> {
  /** Files written before the first open (vault paths → content). */
  files?: Record<string, string | Buffer>;
}

export async function createIndexedVault(options: IndexedVaultOptions = {}): Promise<IndexedVault> {
  const base = makeTempDir('sb index Đồ án');
  const root = path.join(base, 'vault của tôi');
  const disk = (p: string) => path.join(root, ...p.split('/'));
  const writeFile = (p: string, content: string | Buffer) => {
    mkdirSync(path.dirname(disk(p)), { recursive: true });
    writeFileSync(disk(p), content);
  };
  mkdirSync(root);
  for (const [p, content] of Object.entries(options.files ?? {})) writeFile(p, content);
  const { files: _files, ...indexOptions } = options;
  const { vault } = await openVault({ root, ...(options.now ? { now: options.now } : {}) });
  const open = (extra: Partial<OpenIndexOptions> = {}) =>
    openIndex({ vault, ...indexOptions, ...extra });
  const handle: IndexedVault = {
    base,
    root,
    vault,
    index: await open(),
    writeFile,
    removeFile: (p) => rmSync(disk(p)),
    renameFile: (from, to) => {
      mkdirSync(path.dirname(disk(to)), { recursive: true });
      renameSync(disk(from), disk(to));
    },
    put: async (p, content) => {
      writeFile(p, content);
      await handle.index.updateFile(p);
    },
    reopen: async (extra) => {
      handle.index.close();
      handle.index = await open(extra);
      return handle.index;
    },
    cleanup: async () => {
      handle.index.close();
      await vault.close();
      removeDir(base);
    },
  };
  return handle;
}

export const titles = (results: { title: string }[]) => results.map((r) => r.title);

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'index',
);

/** Every file of `server/test/fixtures/index/<name>` as vault path → bytes. */
export function fixtureFiles(name: string): Record<string, Buffer> {
  const rootDir = path.join(FIXTURES, name);
  const out: Record<string, Buffer> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else
        out[path.relative(rootDir, full).split(path.sep).join('/').normalize('NFC')] =
          readFileSync(full);
    }
  };
  walk(rootDir);
  return out;
}
