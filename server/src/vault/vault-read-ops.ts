import { open, readdir, stat, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { isInternalTopFolder, segmentProblem } from '../security/path-guard.js';
import { decodeStrict, decodeText, notFound, revisionOf } from './vault-errors.js';
import { isVaultTempFileName } from './vault-layout.js';
import { resolveFile, resolvePath, type VaultCore } from './vault-core.js';
import type { BytesRead, FileStat, NoteRead, VaultListing, VaultPath } from './vault-types.js';

/**
 * Every file and folder a vault path can address. Skipped: the internal top folders, our own temp
 * files, symlinks (never followed, so a link cannot pull outside files into the index) and names
 * the path guard would refuse (they could not be opened through the API anyway).
 */
export async function listVault(core: VaultCore): Promise<VaultListing> {
  const files: FileStat[] = [];
  const folders: VaultPath[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const subfolders: [string, VaultPath][] = [];
    const fileStats: Promise<FileStat | null>[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (prefix === '' && isInternalTopFolder(name)) continue;
      if (segmentProblem(name) !== null) continue;
      const vaultPath = (prefix ? `${prefix}/${name}` : name).normalize('NFC');
      const abs = path.join(dir, name);
      if (entry.isDirectory()) {
        // A folder parked under its interim name mid-rename is reported once it lands.
        if (isVaultTempFileName(name)) continue;
        folders.push(vaultPath);
        subfolders.push([abs, vaultPath]);
      } else if (entry.isFile() && !isVaultTempFileName(name)) {
        fileStats.push(
          stat(abs).then(
            (info) => ({ path: vaultPath, size: info.size, mtimeMs: info.mtimeMs }),
            () => null,
          ),
        );
      }
    }
    for (const item of await Promise.all(fileStats)) if (item) files.push(item);
    for (const [abs, vaultPath] of subfolders) await walk(abs, vaultPath);
  }
  await walk(core.root, '');
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  folders.sort();
  return { files, folders };
}

export async function statVaultFile(core: VaultCore, input: VaultPath): Promise<FileStat | null> {
  const location = await resolvePath(core, input, 'fast');
  if (location.kind !== 'file') return null;
  try {
    const info = await stat(location.abs);
    return { path: location.vaultPath, size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

/** Bytes and stat from one open handle, so the revision and mtime describe the same file. */
async function readWithStat(abs: string): Promise<{ bytes: Buffer; mtimeMs: number }> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(abs, 'r');
    const bytes = await handle.readFile();
    const info = await handle.stat();
    return { bytes, mtimeMs: info.mtimeMs };
  } finally {
    await handle?.close();
  }
}

export async function readVaultBytes(core: VaultCore, input: VaultPath): Promise<BytesRead> {
  const location = await resolveFile(core, input);
  let read;
  try {
    read = await readWithStat(location.abs);
  } catch (error) {
    // Deleted (or replaced by a folder) between the lookup and the read.
    if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
      throw notFound(location.vaultPath);
    }
    throw error;
  }
  const { bytes, mtimeMs } = read;
  return {
    path: location.vaultPath,
    bytes,
    revision: revisionOf(bytes),
    mtimeMs,
    size: bytes.length,
  };
}

export async function readVaultNote(core: VaultCore, input: VaultPath): Promise<NoteRead> {
  const { bytes, ...rest } = await readVaultBytes(core, input);
  // A BOM is fine (it is valid UTF-8); anything that needs U+FFFD to decode is not.
  return { ...rest, content: decodeText(bytes), utf8: decodeStrict(bytes) !== null };
}

export async function resolveExistingFile(core: VaultCore, input: VaultPath): Promise<string> {
  return (await resolveFile(core, input)).abs;
}

export async function resolveExistingEntry(
  core: VaultCore,
  input: VaultPath,
): Promise<{ path: VaultPath; abs: string; kind: 'file' | 'dir' }> {
  const location = await resolvePath(core, input, 'fast');
  if (location.kind !== 'file' && location.kind !== 'dir') throw notFound(location.vaultPath);
  return { path: location.vaultPath, abs: location.abs, kind: location.kind };
}
