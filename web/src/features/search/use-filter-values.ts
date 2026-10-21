import { useEffect, useMemo, useState } from 'react';
import { getTags } from '../../lib/api/search-api';
import type { TagCount } from '../../lib/api/search-types';
import type { TreeFolder, VaultTree } from '../../lib/api/tree-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { useTreeStore } from '../../lib/tree-store';
import type { FilterValueSources } from './filter-suggestions';
import type { FilterKey } from './palette-query';

/** Top-level folders whose files are never search results (templates, attachments). */
const UNSEARCHED_FOLDERS = new Set(['templates', 'attachments']);

/** Every folder of the tree (any depth), in tree order, without the unsearched ones. */
export function folderPaths(tree: VaultTree | null): VaultPath[] {
  const out: VaultPath[] = [];
  const walk = (folder: TreeFolder) => {
    for (const child of folder.folders) {
      const top = child.path.split('/')[0]?.toLowerCase() ?? '';
      if (UNSEARCHED_FOLDERS.has(top)) continue;
      out.push(child.path);
      walk(child);
    }
  };
  if (tree) walk(tree.root);
  return out;
}

/**
 * Values the filter suggestions draw from. Tags are fetched once per palette opening, the first
 * time `tag:` is typed; folders come from the sidebar tree (loaded on demand if it is not yet).
 */
export function useFilterValues(key: FilterKey | null): FilterValueSources {
  const tree = useTreeStore((state) => state.tree);
  const [tags, setTags] = useState<TagCount[] | null>(null);
  const needTags = key === 'tag' && tags === null;
  const needTree = key === 'folder' && tree === null;

  useEffect(() => {
    if (!needTags) return;
    let alive = true;
    getTags()
      .then((answer) => alive && setTags(answer.tags))
      // Without the tag list the filter still works when typed in full.
      .catch(() => alive && setTags([]));
    return () => {
      alive = false;
    };
  }, [needTags]);

  useEffect(() => {
    if (needTree && useTreeStore.getState().status !== 'loading') {
      void useTreeStore.getState().fetchTree();
    }
  }, [needTree]);

  const folders = useMemo(() => folderPaths(tree), [tree]);
  return useMemo(() => ({ tags: tags ?? [], folders }), [tags, folders]);
}
