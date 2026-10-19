/** Vault path helpers (forward slashes, `''` = the vault root). */
import type { VaultPath } from './api/vault-types';

export const INBOX_FOLDER = '0 Inbox';
export const ARCHIVE_FOLDER = '4 Archive';

/** `.md` (any case): the only files that are notes. */
export function isNotePath(path: VaultPath): boolean {
  return /\.md$/i.test(path);
}

export function baseName(path: VaultPath): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** File name without `.md` (SPEC §4.1: the note title). */
export function noteTitleFromPath(path: VaultPath): string {
  const name = baseName(path);
  return isNotePath(name) ? name.slice(0, -3) : name;
}

/** Parent folder; `''` for items at the vault root. */
export function parentFolder(path: VaultPath): VaultPath {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

export function joinPath(folder: VaultPath, name: string): VaultPath {
  return folder === '' ? name : `${folder}/${name}`;
}

/** Identity key: NFC + lowercase (Windows treats case and NFC/NFD variants as one file). */
export function pathKey(path: VaultPath): string {
  return path.normalize('NFC').toLowerCase();
}

export function samePath(a: VaultPath, b: VaultPath): boolean {
  return pathKey(a) === pathKey(b);
}

/** True when `path` is `folder` itself or lies below it. */
export function isInsideFolder(path: VaultPath, folder: VaultPath): boolean {
  if (folder === '') return true;
  const p = pathKey(path);
  const f = pathKey(folder);
  return p === f || p.startsWith(`${f}/`);
}

/** Rewrites the `oldPrefix` part of `path` (itself or a descendant) to `newPrefix`. */
export function replacePathPrefix(path: VaultPath, oldPrefix: VaultPath, newPrefix: VaultPath) {
  if (samePath(path, oldPrefix)) return newPrefix;
  if (!isInsideFolder(path, oldPrefix)) return path;
  return newPrefix + path.slice(oldPrefix.length);
}
