import { useRef, useState, type DragEvent } from 'react';
import { moveFolder, moveNote } from '../../lib/note-operations';
import { isInsideFolder, parentFolder, samePath } from '../../lib/vault-paths';
import type { TreeRow } from './tree-model';

const DRAG_TYPE = 'application/x-second-brain-path';

interface DragSource {
  kind: 'note' | 'folder';
  path: string;
}

/** A note or a non-standard folder may go into any other folder except where it already is. */
export function canDropInto(source: DragSource, folder: string): boolean {
  if (samePath(parentFolder(source.path), folder)) return false;
  if (source.kind === 'folder' && isInsideFolder(folder, source.path)) return false;
  return true;
}

export function isDraggable(row: TreeRow): boolean {
  return row.kind === 'note' || !row.standard;
}

/** Drag a note (or a non-standard folder) onto a folder → move with relink. */
export function useTreeDragDrop() {
  const source = useRef<DragSource | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  function rowProps(row: TreeRow) {
    return {
      draggable: isDraggable(row),
      onDragStart: (event: DragEvent) => {
        if (!isDraggable(row)) return;
        source.current = { kind: row.kind, path: row.path };
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(DRAG_TYPE, row.path);
        event.dataTransfer.setData('text/plain', row.path);
      },
      onDragEnd: () => {
        source.current = null;
        setDropTarget(null);
      },
      onDragOver: (event: DragEvent) => {
        if (row.kind !== 'folder' || !source.current) return;
        if (!canDropInto(source.current, row.path)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        if (dropTarget !== row.id) setDropTarget(row.id);
      },
      onDragLeave: () => {
        if (dropTarget === row.id) setDropTarget(null);
      },
      onDrop: (event: DragEvent) => {
        const dragged = source.current;
        source.current = null;
        setDropTarget(null);
        if (row.kind !== 'folder' || !dragged || !canDropInto(dragged, row.path)) return;
        event.preventDefault();
        if (dragged.kind === 'note') void moveNote(dragged.path, row.path);
        else void moveFolder(dragged.path, row.path);
      },
    };
  }

  return { dropTarget, rowProps };
}
