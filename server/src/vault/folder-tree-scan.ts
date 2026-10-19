import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { segmentProblem } from '../security/path-guard.js';
import type { FolderFile } from './journal-types.js';
import { revisionOf } from './vault-errors.js';
import { readFileState } from './vault-file-state.js';
import { isVaultTempFileName } from './vault-layout.js';

export interface FolderTree {
  /** Files below the folder (relative paths, NFC, forward slashes) with their revisions. */
  files: FolderFile[];
  /** Subfolders (relative paths), parents before children. */
  folders: string[];
  /** Digest of the file list: the folder step's "revision" in the journal. */
  digest: string;
}

/**
 * Everything a folder move carries, as vault paths can name it. Symlinks, our own temp files and
 * names the path guard refuses still move with the folder but are not listed (no vault path can
 * address them, so nothing reports or indexes them).
 */
export async function scanFolderTree(abs: string): Promise<FolderTree> {
  const files: FolderFile[] = [];
  const folders: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (segmentProblem(entry.name) !== null || isVaultTempFileName(entry.name)) continue;
      const relative = (prefix ? `${prefix}/${entry.name}` : entry.name).normalize('NFC');
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        folders.push(relative);
        await walk(child, relative);
      } else if (entry.isFile()) {
        const state = await readFileState(child);
        if (state) files.push({ path: relative, revision: state.revision });
      }
    }
  }
  await walk(abs, '');
  return { files, folders, digest: revisionOf(Buffer.from(JSON.stringify(files), 'utf8')) };
}
