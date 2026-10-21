/**
 * What AI may read (SPEC F33 "folder scope", plan privacy rules): a path is in scope when its
 * folder is in the effective scope AND its class may ever be sent (never templates, attachments'
 * bytes or `.secondbrain`). Folder names compare like content classes do (NFC, case-insensitive),
 * because Windows treats `4 archive` and `4 Archive` as the same folder.
 */
import { readdirSync } from 'node:fs';
import { classifyPath, topFolderOfPath } from '../../markdown/content-classes.js';
import { isInternalTopFolder } from '../../security/path-guard.js';
import type { VaultPath } from '../../vault/vault-types.js';

/** Left out of the default scope (raw sources and the archive). */
export const DEFAULT_EXCLUDED_FOLDERS = ['3 Resources', '4 Archive'];
/** Folders whose files are never sent, whatever the scope says. */
const NEVER_SENT_FOLDERS = ['templates', 'attachments'];

const fold = (value: string): string => value.normalize('NFC').toLowerCase();
const EXCLUDED = new Set(DEFAULT_EXCLUDED_FOLDERS.map(fold));

/**
 * The folder rule alone; `folders` null = the default scope. Hidden top folders (`.trash`,
 * `.obsidian`: deleted notes, other apps' files) are never in the default scope, as they are
 * never named in the status scope nor in the consent dialog.
 */
export function folderInScope(path: VaultPath, folders: readonly string[] | null): boolean {
  const top = topFolderOfPath(path);
  if (folders === null) return !EXCLUDED.has(fold(top)) && !top.startsWith('.');
  const folded = fold(path);
  return folders.some((folder) =>
    folder === '' ? top === '' : folded.startsWith(`${fold(folder)}/`),
  );
}

export function pathInScope(path: VaultPath, folders: readonly string[] | null): boolean {
  if (path === '' || path.startsWith('/') || path.split('/').some((s) => s === '..' || s === ''))
    return false;
  if (isInternalTopFolder(topFolderOfPath(path))) return false;
  const kind = classifyPath(path);
  if (kind === 'template' || kind === 'attachment') return false;
  // Control docs: `CLAUDE.md` (instructions for the MCP wiki maintainer) and the append-only
  // `wiki/log.md` are not knowledge to answer from; the wiki catalog `wiki/index.md` is.
  if (kind === 'control' && fold(path) !== 'wiki/index.md') return false;
  return folderInScope(path, folders);
}

/** Top-level folders of the vault (names only; hidden and internal folders left out). */
export function listTopFolders(vaultRoot: string): string[] {
  try {
    return readdirSync(vaultRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name.normalize('NFC'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/** `AiStatus.scope`: the folders AI reads now ('' = root notes), without never-sent folders. */
export function effectiveScope(
  folders: readonly string[] | null,
  topFolders: readonly string[],
): string[] {
  if (folders !== null) return [...folders];
  const kept = topFolders.filter(
    (name) => !EXCLUDED.has(fold(name)) && !NEVER_SENT_FOLDERS.includes(fold(name)),
  );
  return ['', ...kept];
}
