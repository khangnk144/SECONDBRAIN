/**
 * Flattens the vault tree into the rows currently visible (expanded folders only). The tree is
 * rendered flat with `aria-level` / `aria-setsize` / `aria-posinset`, which keeps roving focus
 * simple. Only folders and `.md` notes are shown in M2.
 */
import type { TreeFolder, VaultTree } from '../../lib/api/tree-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { isStandardFolder } from '../../lib/standard-folders';
import { isExpanded } from '../../lib/tree-store';
import { pathKey } from '../../lib/vault-paths';

interface RowBase {
  /** Stable id: `f:<path>` for folders, `n:<path>` for notes. */
  id: string;
  path: VaultPath;
  level: number;
  setSize: number;
  posInSet: number;
  /** Id of the parent folder row, null at the top level. */
  parentId: string | null;
}

export interface FolderRow extends RowBase {
  kind: 'folder';
  name: string;
  expanded: boolean;
  hasChildren: boolean;
  noteCount: number;
  urgent: boolean;
  /** Notes directly in `0 Inbox` (badge); null for other folders. */
  inboxCount: number | null;
  standard: boolean;
}

export interface NoteRow extends RowBase {
  kind: 'note';
  title: string;
}

export type TreeRow = FolderRow | NoteRow;

export const folderRowId = (path: VaultPath) => `f:${path}`;
export const noteRowId = (path: VaultPath) => `n:${path}`;
const INBOX_KEY = pathKey('0 Inbox');

export function visibleRows(tree: VaultTree | null, expanded: readonly VaultPath[]): TreeRow[] {
  const rows: TreeRow[] = [];
  if (!tree) return rows;

  function walk(folder: TreeFolder, level: number, parentId: string | null) {
    const notes = folder.files.filter((file) => file.isNote);
    const setSize = folder.folders.length + notes.length;
    let pos = 0;
    for (const child of folder.folders) {
      const open = isExpanded(expanded, child.path);
      const row: FolderRow = {
        kind: 'folder',
        id: folderRowId(child.path),
        path: child.path,
        name: child.name,
        level,
        setSize,
        posInSet: ++pos,
        parentId,
        expanded: open,
        hasChildren: child.folders.length > 0 || child.files.some((file) => file.isNote),
        noteCount: child.noteCount,
        urgent: child.urgent,
        inboxCount: pathKey(child.path) === INBOX_KEY && tree ? tree.inboxCount : null,
        standard: isStandardFolder(child.path),
      };
      rows.push(row);
      if (open) walk(child, level + 1, row.id);
    }
    for (const note of notes) {
      rows.push({
        kind: 'note',
        id: noteRowId(note.path),
        path: note.path,
        title: note.title,
        level,
        setSize,
        posInSet: ++pos,
        parentId,
      });
    }
  }

  walk(tree.root, 1, null);
  return rows;
}
