/**
 * "Show this folder in the tree" from outside the tree ("Dọn Inbox" without AI, F26.1): the
 * folder is expanded and the next tree on screen (the calm sidebar, bento's folder pane, or a
 * drawer that opens for it) selects its row and moves focus there. One request is applied once.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { useTreeStore } from '../../lib/tree-store';
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';
import type { TreeRow } from './tree-model';

interface TreeRevealState {
  /** The folder waiting to be shown, until a tree has shown it. */
  folder: VaultPath | null;
}

export const useTreeReveal = create<TreeRevealState>(() => ({ folder: null }));

export function revealFolderInTree(folder: VaultPath): void {
  useTreeStore.getState().setExpanded(folder, true);
  useTreeReveal.setState({ folder });
}

/** Test helper. */
export function resetTreeReveal(): void {
  useTreeReveal.setState({ folder: null });
}

/**
 * Applies a waiting request in a tree: once the folder's row is drawn it becomes the roving row
 * and gets focus. `focusRow` hands focus over after the next render, so a drawer that mounts
 * this tree has already done its own first focus and still returns focus to its opener (the
 * "Dọn Inbox" button) when it closes.
 */
export function useApplyTreeReveal(rows: readonly TreeRow[], focusRow: (id: string) => void): void {
  const folder = useTreeReveal((state) => state.folder);
  useEffect(() => {
    if (folder === null) return;
    const row = rows.find((r) => r.kind === 'folder' && samePath(r.path, folder));
    if (!row) return; // the tree is still loading
    useTreeReveal.setState({ folder: null });
    focusRow(row.id);
  }, [folder, rows, focusRow]);
}
