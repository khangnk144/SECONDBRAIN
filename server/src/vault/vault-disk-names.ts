import { lstat, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { VaultError, type VaultPath } from './vault-types.js';

/**
 * How a vault path is matched against real directory entries, segment by segment:
 * - `fast` (reads of existing files): the exact name when it exists, else the entry whose NFC form
 *   equals the segment (NFD names written by macOS), and on Windows also case-insensitively.
 * - `real` (targets of create/rename/restore and journal steps): always the true on-disk names,
 *   matched exact → NFC → NFC + case-insensitive on every platform, so an existence check on Linux
 *   means what it means on Windows.
 */
export type MatchMode = 'fast' | 'real';

export interface DiskLocation {
  /** Absolute path: real names for the existing prefix, the requested names after it. */
  abs: string;
  /** Vault path built the same way, NFC-normalized (what list() and the watcher report). */
  vaultPath: VaultPath;
  /** What exists at the full path (`null` = nothing). */
  kind: 'file' | 'dir' | 'other' | null;
  /** Number of leading segments that exist on disk. */
  existingDepth: number;
  segments: string[];
}

const fold = (name: string) => name.normalize('NFC').toLowerCase();

async function entryNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** The real entry in `dir` that `segment` refers to, or null. */
export async function matchEntry(
  dir: string,
  segment: string,
  mode: MatchMode,
): Promise<string | null> {
  if (mode === 'fast' && (await pathExists(path.join(dir, segment)))) return segment;
  const names = await entryNames(dir);
  if (mode === 'real' && names.includes(segment)) return segment;
  const nfc = names.find((name) => name.normalize('NFC') === segment);
  if (nfc !== undefined) return nfc;
  if (mode === 'real' || process.platform === 'win32') {
    const key = fold(segment);
    return names.find((name) => fold(name) === key) ?? null;
  }
  return null;
}

async function kindOf(abs: string): Promise<DiskLocation['kind']> {
  try {
    const info = await stat(abs);
    if (info.isFile()) return 'file';
    return info.isDirectory() ? 'dir' : 'other';
  } catch {
    return null;
  }
}

/** Maps a guarded vault path to disk. Throws INVALID_PATH when a parent segment is a file. */
export async function locate(
  root: string,
  vaultPath: VaultPath,
  mode: MatchMode,
): Promise<DiskLocation> {
  const requested = vaultPath.split('/');
  if (mode === 'fast') {
    // Common case (the indexer reading every note): the exact path exists, no walk needed.
    const kind = await kindOf(path.join(root, ...requested));
    if (kind !== null) return finish(root, requested, kind, requested.length);
  }
  const segments: string[] = [];
  let current = root;
  for (let i = 0; i < requested.length; i += 1) {
    const name = await matchEntry(current, requested[i]!, mode);
    if (name === null) {
      segments.push(...requested.slice(i));
      return finish(root, segments, null, i);
    }
    segments.push(name);
    current = path.join(current, name);
    if (i < requested.length - 1 && (await kindOf(current)) !== 'dir') {
      throw new VaultError('INVALID_PATH', `A parent of ${vaultPath} is not a folder`, {
        path: vaultPath,
        reason: 'parent-not-folder',
      });
    }
  }
  return finish(root, segments, await kindOf(current), requested.length);
}

function finish(
  root: string,
  segments: string[],
  kind: DiskLocation['kind'],
  existingDepth: number,
): DiskLocation {
  return {
    abs: path.join(root, ...segments),
    vaultPath: segments.join('/').normalize('NFC'),
    kind,
    existingDepth,
    segments,
  };
}

/** Vault path of an absolute path under the real root (forward slashes, NFC). */
export function toVaultPath(root: string, abs: string): VaultPath {
  return path.relative(root, abs).split(path.sep).join('/').normalize('NFC');
}
