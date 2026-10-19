import type { TreeFolder } from '../../lib/api/tree-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { foldText } from '../../lib/fold-text';

export interface FolderOption {
  path: VaultPath;
  /** Display name (`''` for the root, which the view labels itself). */
  name: string;
  depth: number;
}

/** Every folder of the tree in vault order (depth-first), optionally with the root first. */
export function folderOptions(root: TreeFolder | null, includeRoot: boolean): FolderOption[] {
  const out: FolderOption[] = includeRoot ? [{ path: '', name: '', depth: 0 }] : [];
  const walk = (folder: TreeFolder, depth: number) => {
    for (const child of folder.folders) {
      out.push({ path: child.path, name: child.name, depth });
      walk(child, depth + 1);
    }
  };
  if (root) walk(root, includeRoot ? 1 : 0);
  return out;
}

/** Diacritic-insensitive filter on the folder path (`giai tich` finds `Giải tích`). */
export function filterFolderOptions(
  options: FolderOption[],
  query: string,
  rootLabel: string,
): FolderOption[] {
  const needle = foldText(query.trim());
  if (needle === '') return options;
  return options.filter((option) =>
    foldText(option.path === '' ? rootLabel : option.path).includes(needle),
  );
}
