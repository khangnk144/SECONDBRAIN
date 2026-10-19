/** Test helper: builds a `/api/tree` answer from paths, keeping the order given (server order). */
import type { TreeFolder, VaultTree } from '../api/tree-types';

export interface TreeFixture {
  folders: string[];
  notes: string[];
  /** Folders flagged `urgent` (and their ancestors). */
  urgent?: string[];
}

export function makeTree({ folders, notes, urgent = [] }: TreeFixture): VaultTree {
  const root: TreeFolder = {
    path: '',
    name: '',
    noteCount: 0,
    urgent: false,
    folders: [],
    files: [],
  };
  const byPath = new Map<string, TreeFolder>([['', root]]);
  const parentOf = (path: string) => path.slice(0, Math.max(path.lastIndexOf('/'), 0));
  const nameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

  function folder(path: string): TreeFolder {
    const found = byPath.get(path);
    if (found) return found;
    const created: TreeFolder = {
      path,
      name: nameOf(path),
      noteCount: 0,
      urgent: false,
      folders: [],
      files: [],
    };
    byPath.set(path, created);
    folder(parentOf(path)).folders.push(created);
    return created;
  }

  for (const path of folders) folder(path);
  for (const path of notes) {
    const name = nameOf(path);
    folder(parentOf(path)).files.push({
      path,
      name,
      title: name.replace(/\.md$/i, ''),
      class: 'user',
      isNote: /\.md$/i.test(path),
      size: 10,
      mtime: 0,
    });
    for (let p = parentOf(path); ; p = parentOf(p)) {
      folder(p).noteCount += 1;
      if (p === '') break;
    }
  }
  for (const path of urgent) {
    for (let p = path; ; p = parentOf(p)) {
      folder(p).urgent = true;
      if (p === '') break;
    }
  }
  const inboxCount = notes.filter((p) => parentOf(p) === '0 Inbox' && /\.md$/i.test(p)).length;
  return { root, inboxCount };
}
