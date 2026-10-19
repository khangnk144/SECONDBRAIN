import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { samePath } from '../../lib/vault-paths';
import type { TreeRow } from './tree-model';

/**
 * Roving tabindex for the flat tree: one row is focusable (tabindex 0). When the focused row
 * disappears (trashed, moved) the row now at the same position takes over, and if the tree had
 * keyboard focus, DOM focus follows so the user can keep going.
 */
export function useRovingTreeFocus(rows: TreeRow[], activePath: string | null) {
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  /** Row id that should receive DOM focus as soon as it is rendered. */
  const pendingFocus = useRef<string | null>(null);
  const lastIndex = useRef(0);
  const treeHadFocus = useRef(false);

  let focusedIndex = rows.findIndex((row) => row.id === focusedId);
  const vanished = focusedId !== null && focusedIndex === -1;
  if (focusedIndex === -1) {
    if (vanished) focusedIndex = Math.min(lastIndex.current, rows.length - 1);
    else {
      const active = rows.findIndex(
        (row) => row.kind === 'note' && activePath !== null && samePath(row.path, activePath),
      );
      focusedIndex = Math.max(active, 0);
    }
  }
  const focusedRow: TreeRow | undefined = rows[focusedIndex];

  const substituteId = vanished ? (focusedRow?.id ?? null) : null;
  useEffect(() => {
    if (substituteId === null) return;
    if (treeHadFocus.current && document.activeElement === document.body) {
      pendingFocus.current = substituteId;
    }
    setFocusedId(substituteId);
  }, [substituteId]);

  // Runs after every render: hands DOM focus to the row that asked for it once it exists.
  useEffect(() => {
    lastIndex.current = Math.max(focusedIndex, 0);
    const target = pendingFocus.current;
    if (target === null) return;
    const element = itemRefs.current.get(target);
    if (element) {
      pendingFocus.current = null;
      element.focus();
    }
  });

  return {
    focusedIndex,
    focusedRow,
    /** Moves the roving focus (and DOM focus) to a row. */
    focusRow: (id: string) => {
      pendingFocus.current = id;
      setFocusedId(id);
    },
    /** Marks a row as current without moving DOM focus (mouse clicks focus it themselves). */
    selectRow: (id: string) => {
      pendingFocus.current = null;
      setFocusedId(id);
    },
    itemRef: (id: string) => (element: HTMLLIElement | null) => {
      if (element) itemRefs.current.set(id, element);
      else itemRefs.current.delete(id);
    },
    element: (id: string) => itemRefs.current.get(id) ?? null,
    containerFocusProps: {
      onFocus: () => {
        treeHadFocus.current = true;
      },
      onBlur: (event: FocusEvent) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) {
          treeHadFocus.current = false;
        }
      },
    },
  };
}
