import { stat } from 'node:fs/promises';
import { guardVaultPath } from '../security/path-guard.js';
import { applyTextPatches } from './text-range-patches.js';
import { assertNotSymlink, resolvePath, type VaultCore } from './vault-core.js';
import { createVaultFile, ensureFolders, writeVaultFile } from './vault-disk-io.js';
import type { DiskLocation } from './vault-disk-names.js';
import {
  alreadyExists,
  conflict,
  decodeStrict,
  notUtf8,
  revisionOf,
  validation,
} from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { isVaultError } from './vault-types.js';
import type {
  PatchedNote,
  PatchPlanner,
  TextRangePatch,
  VaultPath,
  WriteResult,
} from './vault-types.js';

const MAX_UNIQUE_SUFFIX = 9999;

const toBytes = (content: string | Uint8Array) =>
  typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);

async function mtimeOf(abs: string): Promise<number> {
  return (await stat(abs)).mtimeMs;
}

async function writeNewFile(
  core: VaultCore,
  target: DiskLocation,
  bytes: Buffer,
): Promise<WriteResult> {
  await ensureFolders(core, target, false);
  await createVaultFile(core, target.vaultPath, target.abs, bytes);
  const revision = revisionOf(bytes);
  core.emit({ kind: 'created', path: target.vaultPath, revision, origin: 'app' });
  return { path: target.vaultPath, revision, mtimeMs: await mtimeOf(target.abs) };
}

export function createFile(
  core: VaultCore,
  input: VaultPath,
  content: string | Uint8Array,
): Promise<WriteResult> {
  return core.queue.run(async () => {
    const target = await resolvePath(core, input, 'real');
    if (target.kind !== null) throw alreadyExists(target.vaultPath);
    return writeNewFile(core, target, toBytes(content));
  });
}

/** Inserts `suffix` before the extension of the last segment: `a/x.md` + ` 2` → `a/x 2.md`. */
export function withNameSuffix(vaultPath: VaultPath, suffix: string): VaultPath {
  const slash = vaultPath.lastIndexOf('/');
  const dir = vaultPath.slice(0, slash + 1);
  const name = vaultPath.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  return `${dir}${stem}${suffix}${ext}`;
}

export function createUniqueFile(
  core: VaultCore,
  input: VaultPath,
  content: string | Uint8Array,
): Promise<WriteResult> {
  return core.queue.run(async () => {
    const base = guardVaultPath(input);
    for (let n = 1; n <= MAX_UNIQUE_SUFFIX; n += 1) {
      const candidate = n === 1 ? base : withNameSuffix(base, ` ${n}`);
      const target = await resolvePath(core, candidate, 'real');
      if (target.kind !== null) continue;
      try {
        return await writeNewFile(core, target, toBytes(content));
      } catch (error) {
        // Another program took the name between the check and the creation: try the next one.
        if (!(isVaultError(error) && error.code === 'EXISTS')) throw error;
      }
    }
    throw alreadyExists(input);
  });
}

export function createVaultFolder(core: VaultCore, input: VaultPath): Promise<void> {
  return core.queue.run(async () => {
    const target = await resolvePath(core, input, 'real');
    if (target.kind !== null) throw alreadyExists(target.vaultPath);
    await ensureFolders(core, target, true);
  });
}

/**
 * Re-reads the file inside the queue and checks it can be rewritten: not a symlink, still at the
 * revision the client based its change on, and UTF-8 text (anything else would be re-encoded).
 */
export async function readAtRevision(
  core: VaultCore,
  input: VaultPath,
  expectedRevision: string,
): Promise<{ target: DiskLocation; current: Buffer }> {
  const target = await resolvePath(core, input, 'fast');
  await assertNotSymlink(target, input);
  const current = target.kind === 'file' ? await readFileState(target.abs) : null;
  if (!current || current.revision !== expectedRevision) throw conflict(target.vaultPath, current);
  if (!current.bytes) {
    throw validation('The file is too large to edit', {
      path: target.vaultPath,
      reason: 'too-large',
    });
  }
  if (decodeStrict(current.bytes) === null) throw notUtf8(target.vaultPath);
  return { target, current: current.bytes };
}

export async function replaceContent(
  core: VaultCore,
  target: DiskLocation,
  current: Buffer,
  next: Buffer,
): Promise<WriteResult> {
  // Identical bytes: nothing to write, so the mtime and watchers stay quiet.
  if (current.equals(next)) {
    return {
      path: target.vaultPath,
      revision: revisionOf(current),
      mtimeMs: await mtimeOf(target.abs),
    };
  }
  await writeVaultFile(core, target.vaultPath, target.abs, next);
  const revision = revisionOf(next);
  core.emit({ kind: 'written', path: target.vaultPath, revision, origin: 'app' });
  return { path: target.vaultPath, revision, mtimeMs: await mtimeOf(target.abs) };
}

export function writeFile(
  core: VaultCore,
  input: VaultPath,
  content: string,
  expectedRevision: string,
): Promise<WriteResult> {
  return core.queue.run(async () => {
    const { target, current } = await readAtRevision(core, input, expectedRevision);
    return replaceContent(core, target, current, Buffer.from(content, 'utf8'));
  });
}

export function patchFile(
  core: VaultCore,
  input: VaultPath,
  patches: TextRangePatch[],
  expectedRevision: string,
): Promise<WriteResult> {
  return core.queue.run(async () => {
    const { target, current } = await readAtRevision(core, input, expectedRevision);
    const next = applyTextPatches(decodeStrict(current)!, patches);
    return replaceContent(core, target, current, Buffer.from(next, 'utf8'));
  });
}

/** Patches computed from the content at the revision; no patches = nothing written. */
export function patchFileWith(
  core: VaultCore,
  input: VaultPath,
  expectedRevision: string,
  plan: PatchPlanner,
): Promise<PatchedNote> {
  return core.queue.run(async () => {
    const { target, current } = await readAtRevision(core, input, expectedRevision);
    const text = decodeStrict(current)!;
    const patches = plan(text);
    const next = patches.length === 0 ? text : applyTextPatches(text, patches);
    const result = await replaceContent(core, target, current, Buffer.from(next, 'utf8'));
    return { ...result, content: next };
  });
}
