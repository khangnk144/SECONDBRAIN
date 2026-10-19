import { classifyPath, isNotePath, noteTitleFromPath } from '../markdown/content-classes.js';
import type { ContentClass } from '../markdown/markdown-types.js';
import type { VaultListing, VaultPath } from '../vault/vault-types.js';

export interface TreeFile {
  path: VaultPath;
  /** File name with extension. */
  name: string;
  /** Note title (name without `.md`) for notes, the file name otherwise. */
  title: string;
  class: ContentClass;
  isNote: boolean;
  size: number;
  mtime: number;
}

export interface TreeFolder {
  /** '' for the vault root. */
  path: VaultPath;
  name: string;
  /** Notes in this folder and all folders below it. */
  noteCount: number;
  /** Some note in this subtree has an open `urgent` deadline item (sidebar accent dot). */
  urgent: boolean;
  folders: TreeFolder[];
  files: TreeFile[];
}

export interface VaultTree {
  root: TreeFolder;
  /** `.md` files directly in `0 Inbox` (SPEC F2.3: a count of notes, not unread items). */
  inboxCount: number;
}

const INBOX = '0 inbox';
const DAILY = 'daily';
const collator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });

const parentOf = (path: VaultPath): VaultPath => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
const nameOf = (path: VaultPath): string => path.slice(path.lastIndexOf('/') + 1);
const folded = (path: VaultPath): string => path.normalize('NFC').toLowerCase();

/**
 * Folder tree for the sidebar (SPEC F2): folders in vault order (numeric prefixes sort
 * naturally), notes by title, Daily notes newest first.
 */
export function buildVaultTree(
  listing: VaultListing,
  urgentNotePaths: Iterable<VaultPath>,
): VaultTree {
  const root: TreeFolder = {
    path: '',
    name: '',
    noteCount: 0,
    urgent: false,
    folders: [],
    files: [],
  };
  const folders = new Map<string, TreeFolder>([['', root]]);

  function folder(path: VaultPath): TreeFolder {
    const existing = folders.get(folded(path));
    if (existing) return existing;
    const created: TreeFolder = {
      path,
      name: nameOf(path),
      noteCount: 0,
      urgent: false,
      folders: [],
      files: [],
    };
    folders.set(folded(path), created);
    folder(parentOf(path)).folders.push(created);
    return created;
  }

  for (const path of listing.folders) folder(path);
  let inboxCount = 0;
  for (const file of listing.files) {
    const isNote = isNotePath(file.path);
    const parent = parentOf(file.path);
    if (isNote && folded(parent) === INBOX) inboxCount += 1;
    folder(parent).files.push({
      path: file.path,
      name: nameOf(file.path),
      title: noteTitleFromPath(file.path),
      class: classifyPath(file.path),
      isNote,
      size: file.size,
      mtime: file.mtimeMs,
    });
  }
  for (const path of urgentNotePaths) {
    for (let p = parentOf(path); ; p = parentOf(p)) {
      const ancestor = folders.get(folded(p));
      if (ancestor) ancestor.urgent = true;
      if (p === '') break;
    }
  }
  finish(root);
  return { root, inboxCount };
}

/** Sorts children and sums note counts bottom-up. */
function finish(node: TreeFolder): number {
  node.folders.sort((a, b) => collator.compare(a.name, b.name));
  const newestFirst = folded(node.path) === DAILY;
  node.files.sort((a, b) =>
    newestFirst ? collator.compare(b.name, a.name) : collator.compare(a.title, b.title),
  );
  let count = node.files.filter((file) => file.isNote).length;
  for (const child of node.folders) count += finish(child);
  node.noteCount = count;
  return count;
}
