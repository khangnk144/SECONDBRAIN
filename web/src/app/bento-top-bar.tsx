import { MagnifyingGlass, Plus } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { runAppShortcut } from '../lib/commands/command-actions';
import { useSearchUi } from '../lib/search-ui-store';
import { shortcutKeys } from '../lib/shortcuts/use-app-shortcuts';
import { RightPaneToggle } from './pane-toggles';

export interface BentoTopBarProps {
  /** The screen has a primary button of its own: "Ghi chú mới" is secondary then (F35.3). */
  screenHasPrimary: boolean;
  routeHasPanel: boolean;
  rightCollapsed: boolean;
  /** Phones: the right panel is a bottom sheet. */
  compact: boolean;
}

/**
 * Bento top bar (design.md §12.2, F35.3): the search field that opens the palette (`Ctrl+K`) and
 * "Ghi chú mới", which runs the same command as `Alt+N`. On routes with a right panel the pane
 * toggle (`Alt+2`) sits at its end.
 */
export function BentoTopBar({
  screenHasPrimary,
  routeHasPanel,
  rightCollapsed,
  compact,
}: BentoTopBarProps) {
  const { t } = useTranslation();
  const newNote = t('sidebar-tree.newNote');
  const newNoteKeys = shortcutKeys('new-note');
  return (
    <div className="top-bar">
      <button
        type="button"
        className="top-bar__search"
        aria-label={t('rail.searchLabel')}
        aria-haspopup="dialog"
        aria-keyshortcuts="Control+K"
        onClick={() => useSearchUi.getState().openSearch()}
      >
        <MagnifyingGlass size={18} aria-hidden="true" focusable="false" />
        <span className="top-bar__placeholder">{t('rail.search')}</span>
        <kbd className="top-bar__keys" aria-hidden="true">
          {t('rail.searchKeys')}
        </kbd>
      </button>
      <button
        type="button"
        className={`button ${screenHasPrimary ? 'button--secondary' : 'button--primary'} top-bar__new`}
        aria-keyshortcuts={newNoteKeys}
        title={t('panes.withShortcut', { label: newNote, keys: newNoteKeys })}
        onClick={() => runAppShortcut('new-note')}
      >
        <Plus size={18} aria-hidden="true" focusable="false" />
        <span className="top-bar__new-label">{newNote}</span>
      </button>
      {routeHasPanel ? <RightPaneToggle collapsed={rightCollapsed} sheet={compact} /> : null}
    </div>
  );
}
