import { CaretDown, CaretRight } from '@phosphor-icons/react';
import type { DragEvent, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TreeRow } from './tree-model';
import { TreeRenameInput } from './tree-rename-input';

export interface TreeRowItemProps {
  row: TreeRow;
  focused: boolean;
  active: boolean;
  renaming: boolean;
  dropTarget: boolean;
  itemRef: (element: HTMLLIElement | null) => void;
  onActivate: (row: TreeRow, event: MouseEvent) => void;
  onContextMenu: (row: TreeRow, event: MouseEvent) => void;
  onFocusRow: (row: TreeRow) => void;
  onRenameCommit: (row: TreeRow, name: string) => void;
  onRenameCancel: () => void;
  dragProps: {
    draggable: boolean;
    onDragStart: (event: DragEvent) => void;
    onDragEnd: () => void;
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
}

/** One `treeitem`: caret + name for folders (urgent dot, Inbox count), title for notes. */
export function TreeRowItem(props: TreeRowItemProps) {
  const { t } = useTranslation();
  const { row, focused, active, renaming, dropTarget } = props;
  const isFolder = row.kind === 'folder';
  const label = isFolder ? row.name : row.title;
  const classes = ['tree-item', `tree-item--${row.kind}`];
  if (active) classes.push('is-active');
  if (dropTarget) classes.push('is-drop-target');

  return (
    <li
      ref={props.itemRef}
      role="treeitem"
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-expanded={isFolder && row.hasChildren ? row.expanded : undefined}
      aria-selected={focused}
      aria-current={active ? 'page' : undefined}
      tabIndex={focused ? 0 : -1}
      className={classes.join(' ')}
      style={{ paddingInlineStart: `calc(var(--space-1) + ${row.level - 1} * var(--space-4))` }}
      onClick={(event) => props.onActivate(row, event)}
      onAuxClick={(event) => {
        if (event.button === 1 && row.kind === 'note') props.onActivate(row, event);
      }}
      onContextMenu={(event) => props.onContextMenu(row, event)}
      onFocus={(event) => {
        if (event.target === event.currentTarget) props.onFocusRow(row);
      }}
      {...(renaming ? {} : props.dragProps)}
      draggable={!renaming && props.dragProps.draggable}
    >
      <span className="tree-item__caret" aria-hidden="true">
        {isFolder && row.hasChildren ? (
          row.expanded ? (
            <CaretDown size={16} focusable="false" />
          ) : (
            <CaretRight size={16} focusable="false" />
          )
        ) : null}
      </span>
      {/* The dot sits before the name (design.md §5); its spoken hint follows the name. */}
      {isFolder && row.urgent ? <span className="tree-item__urgent" aria-hidden="true" /> : null}
      {renaming ? (
        <TreeRenameInput
          initialName={label}
          onCommit={(name) => props.onRenameCommit(row, name)}
          onCancel={props.onRenameCancel}
        />
      ) : (
        <span className="tree-item__label">{label}</span>
      )}
      {/* Spaces keep the spoken name apart: "1 Projects, có deadline gấp bên trong". */}
      {isFolder && row.urgent ? ' ' : null}
      {isFolder && row.urgent ? (
        <span className="visually-hidden">{t('sidebar-tree.urgent')}</span>
      ) : null}
      {isFolder && row.inboxCount !== null && row.inboxCount > 0 ? ' ' : null}
      {isFolder && row.inboxCount !== null && row.inboxCount > 0 ? (
        <span className="tree-item__badge">
          <span aria-hidden="true">{row.inboxCount}</span>
          <span className="visually-hidden">
            {t('sidebar-tree.inboxCount', { count: row.inboxCount })}
          </span>
        </span>
      ) : null}
    </li>
  );
}
