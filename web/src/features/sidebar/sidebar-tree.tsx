import { useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { renameFolder, renameNote } from '../../lib/note-operations';
import { showToast } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { PopupMenu } from '../dialogs/popup-menu';
import { openNoteRow, trashRow } from './tree-actions';
import { useTreeDragDrop } from './tree-drag-drop';
import { handleTreeKey } from './tree-keyboard';
import { treeMenuItems } from './tree-menu-items';
import { folderRowId, noteRowId, visibleRows, type TreeRow } from './tree-model';
import { useApplyTreeReveal } from './tree-reveal';
import { TreeRowItem } from './tree-row-item';
import { useActiveNotePath } from './use-active-note-path';
import { useRovingTreeFocus } from './use-roving-tree-focus';
import { samePath } from '../../lib/vault-paths';
import './sidebar-tree.css';

interface MenuState {
  row: TreeRow;
  x: number;
  y: number;
}

/** Vault folders and notes as a WAI-ARIA tree (SPEC F2). */
export function SidebarTree({ labelledBy }: { labelledBy: string }) {
  const { t } = useTranslation();
  const tree = useTreeStore((state) => state.tree);
  const expanded = useTreeStore((state) => state.expanded);
  const rows = useMemo(() => visibleRows(tree, expanded), [tree, expanded]);
  const activePath = useActiveNotePath();
  const focus = useRovingTreeFocus(rows, activePath);
  useApplyTreeReveal(rows, focus.focusRow);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const { dropTarget, rowProps } = useTreeDragDrop();

  function setFolderExpanded(row: TreeRow, value: boolean) {
    if (row.kind === 'folder') useTreeStore.getState().setExpanded(row.path, value);
  }

  function startRename(row: TreeRow) {
    if (row.kind === 'folder' && row.standard) {
      showToast({ message: t('operations.errors.forbidden'), tone: 'error' });
      return;
    }
    focus.selectRow(row.id);
    setRenamingId(row.id);
  }

  async function commitRename(row: TreeRow, name: string) {
    setRenamingId(null);
    focus.focusRow(row.id);
    const result =
      row.kind === 'note' ? await renameNote(row.path, name) : await renameFolder(row.path, name);
    if (result.ok) {
      focus.focusRow(row.kind === 'note' ? noteRowId(result.path) : folderRowId(result.path));
    }
  }

  function openMenuFor(row: TreeRow, position?: { x: number; y: number }) {
    const rect = focus.element(row.id)?.getBoundingClientRect();
    focus.selectRow(row.id);
    setMenu({ row, ...(position ?? { x: (rect?.left ?? 0) + 24, y: rect?.bottom ?? 0 }) });
  }

  function onKeyDown(event: KeyboardEvent) {
    if (renamingId !== null || menu !== null) return;
    const used = handleTreeKey(event, {
      rows,
      focusedIndex: focus.focusedIndex,
      focusRow: focus.focusRow,
      setFolderExpanded,
      openNote: (row, newTab) => openNoteRow(row.path, newTab),
      rename: startRename,
      trash: trashRow,
      openMenu: (row) => openMenuFor(row),
    });
    if (used) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function onActivate(row: TreeRow, event: MouseEvent) {
    focus.selectRow(row.id);
    if (row.kind === 'folder') setFolderExpanded(row, !row.expanded);
    else openNoteRow(row.path, event.ctrlKey || event.metaKey || event.button === 1);
  }

  if (rows.length === 0) return null;
  return (
    <>
      <ul
        className="sidebar-tree"
        role="tree"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        {...focus.containerFocusProps}
      >
        {rows.map((row) => (
          <TreeRowItem
            key={row.id}
            row={row}
            focused={row.id === focus.focusedRow?.id}
            active={row.kind === 'note' && activePath !== null && samePath(row.path, activePath)}
            renaming={row.id === renamingId}
            dropTarget={row.id === dropTarget}
            itemRef={focus.itemRef(row.id)}
            onActivate={onActivate}
            onContextMenu={(target, event) => {
              event.preventDefault();
              openMenuFor(target, { x: event.clientX, y: event.clientY });
            }}
            onFocusRow={(target) => focus.selectRow(target.id)}
            onRenameCommit={(target, name) => void commitRename(target, name)}
            onRenameCancel={() => {
              setRenamingId(null);
              focus.focusRow(row.id);
            }}
            dragProps={rowProps(row)}
          />
        ))}
      </ul>
      {menu ? (
        <PopupMenu
          label={t('sidebar-tree.menu.label', {
            name: menu.row.kind === 'folder' ? menu.row.name : menu.row.title,
          })}
          items={treeMenuItems(menu.row, t, startRename)}
          position={{ x: menu.x, y: menu.y }}
          onClose={() => {
            setMenu(null);
            focus.focusRow(menu.row.id);
          }}
        />
      ) : null}
    </>
  );
}
