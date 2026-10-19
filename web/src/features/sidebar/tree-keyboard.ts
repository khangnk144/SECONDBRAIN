/**
 * WAI-ARIA tree keyboard model (SPEC F2.4): ↑/↓ move, → expand or enter a folder, ← collapse or go
 * to the parent, Home/End, Enter opens (Ctrl+Enter in a new tab) or toggles a folder, F2 renames,
 * Delete trashes, the context-menu key or Shift+F10 opens the menu.
 */
import type { KeyboardEvent } from 'react';
import type { FolderRow, NoteRow, TreeRow } from './tree-model';

export interface TreeKeyHandlers {
  rows: TreeRow[];
  focusedIndex: number;
  focusRow: (id: string) => void;
  setFolderExpanded: (row: FolderRow, expanded: boolean) => void;
  openNote: (row: NoteRow, newTab: boolean) => void;
  rename: (row: TreeRow) => void;
  trash: (row: TreeRow) => void;
  openMenu: (row: TreeRow) => void;
}

/** Handles one keydown on the tree; returns true when the key was used. */
export function handleTreeKey(event: KeyboardEvent, h: TreeKeyHandlers): boolean {
  const { rows, focusedIndex } = h;
  const row = rows[focusedIndex];
  if (!row) return false;
  const focusAt = (index: number) => {
    const target = rows[Math.max(0, Math.min(index, rows.length - 1))];
    if (target) h.focusRow(target.id);
  };

  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    h.openMenu(row);
    return true;
  }
  if (event.altKey || event.metaKey) return false;

  switch (event.key) {
    case 'ArrowDown':
      focusAt(focusedIndex + 1);
      return true;
    case 'ArrowUp':
      focusAt(focusedIndex - 1);
      return true;
    case 'Home':
      focusAt(0);
      return true;
    case 'End':
      focusAt(rows.length - 1);
      return true;
    case 'ArrowRight':
      if (row.kind === 'folder' && row.hasChildren) {
        if (!row.expanded) h.setFolderExpanded(row, true);
        else if (rows[focusedIndex + 1]?.parentId === row.id) focusAt(focusedIndex + 1);
      }
      return true;
    case 'ArrowLeft':
      if (row.kind === 'folder' && row.expanded) h.setFolderExpanded(row, false);
      else if (row.parentId) h.focusRow(row.parentId);
      return true;
    case 'Enter':
    case ' ':
      if (row.kind === 'note') h.openNote(row, event.ctrlKey);
      else h.setFolderExpanded(row, !row.expanded);
      return true;
    case 'F2':
      h.rename(row);
      return true;
    case 'Delete':
      h.trash(row);
      return true;
    default:
      return false;
  }
}
