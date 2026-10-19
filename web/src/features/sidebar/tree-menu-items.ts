import {
  Archive,
  ArrowSquareOut,
  FolderOpen,
  FolderPlus,
  FolderSimple,
  NotePencil,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { ARCHIVE_FOLDER, isInsideFolder, parentFolder } from '../../lib/vault-paths';
import type { PopupMenuItem } from '../dialogs/popup-menu';
import {
  archiveRow,
  moveRow,
  newFolderIn,
  newNoteInFolder,
  openNoteRow,
  revealRow,
  trashRow,
} from './tree-actions';
import type { TreeRow } from './tree-model';

/**
 * Context-menu entries of a tree row in the order of SPEC F2: New note, New folder, Rename,
 * Move to…, Move to Archive, Delete, Reveal in Explorer. Notes add "Open in new tab" first and
 * create new items in their own folder.
 */
export function treeMenuItems(
  row: TreeRow,
  t: TFunction,
  startRename: (row: TreeRow) => void,
): PopupMenuItem[] {
  const folder = row.kind === 'folder' ? row.path : parentFolder(row.path);
  const locked = row.kind === 'folder' && row.standard;
  const lockedReason = locked ? t('sidebar-tree.menu.standardFolder') : undefined;
  const archived = isInsideFolder(row.path, ARCHIVE_FOLDER);
  const archiveReason =
    lockedReason ??
    (archived
      ? t(
          row.kind === 'folder'
            ? 'sidebar-tree.menu.folderAlreadyArchived'
            : 'sidebar-tree.menu.alreadyArchived',
        )
      : undefined);

  const items: PopupMenuItem[] = [
    {
      id: 'new-note',
      label: t('sidebar-tree.menu.newNote'),
      icon: NotePencil,
      onSelect: () => newNoteInFolder(folder),
    },
    {
      id: 'new-folder',
      label: t('sidebar-tree.menu.newFolder'),
      icon: FolderPlus,
      onSelect: () => newFolderIn(folder),
    },
    {
      id: 'rename',
      label: t('sidebar-tree.menu.rename'),
      icon: PencilSimple,
      shortcut: 'F2',
      disabled: locked,
      disabledReason: lockedReason,
      onSelect: () => startRename(row),
    },
    {
      id: 'move',
      label: t('sidebar-tree.menu.moveTo'),
      icon: FolderSimple,
      disabled: locked,
      disabledReason: lockedReason,
      onSelect: () => moveRow(row),
    },
    {
      id: 'archive',
      label: t('sidebar-tree.menu.archive'),
      icon: Archive,
      disabled: locked || archived,
      disabledReason: archiveReason,
      onSelect: () => archiveRow(row),
    },
    {
      id: 'trash',
      label: t('sidebar-tree.menu.trash'),
      icon: Trash,
      shortcut: 'Delete',
      disabled: locked,
      disabledReason: lockedReason,
      onSelect: () => trashRow(row),
    },
    {
      id: 'reveal',
      label: t('sidebar-tree.menu.reveal'),
      icon: FolderOpen,
      onSelect: () => revealRow(row),
    },
  ];
  if (row.kind === 'note') {
    items.unshift({
      id: 'open-new-tab',
      label: t('sidebar-tree.menu.openInNewTab'),
      icon: ArrowSquareOut,
      onSelect: () => openNoteRow(row.path, true),
    });
  }
  return items;
}
