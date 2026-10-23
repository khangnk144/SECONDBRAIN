import { List, SidebarSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../lib/panes-store';
import { shortcutKeys } from '../lib/shortcuts/use-app-shortcuts';

/** Id of the right panel's bottom sheet (phones), for `aria-controls`. */
export const PANEL_SHEET_ID = 'right-panel-sheet';
/** Id of the left drawer (folder tree in bento, the whole sidebar in calm). */
export const LEFT_DRAWER_ID = 'left-drawer';

/**
 * Left pane toggle of the calm toolbar (`Alt+1`). On phones it is the menu button that opens
 * the sidebar as a drawer (`aria-expanded`); on wider windows it is the pane toggle as before.
 */
export function LeftPaneToggle({ collapsed, drawer }: { collapsed: boolean; drawer: boolean }) {
  const { t } = useTranslation();
  const keys = shortcutKeys('toggle-left-pane');
  const toggle = () => usePanesStore.getState().toggleLeft();
  if (drawer) {
    const label = t('rail.menu');
    return (
      <button
        type="button"
        className="icon-button"
        aria-label={label}
        aria-expanded={!collapsed}
        aria-controls={collapsed ? undefined : LEFT_DRAWER_ID}
        title={t('panes.withShortcut', { label, keys })}
        onClick={toggle}
      >
        <List size={18} aria-hidden="true" focusable="false" />
      </button>
    );
  }
  const label = collapsed ? t('panes.showLeft') : t('panes.hideLeft');
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={t('panes.withShortcut', { label, keys })}
      onClick={toggle}
    >
      <SidebarSimple size={18} aria-hidden="true" focusable="false" />
    </button>
  );
}

/**
 * Right pane toggle (`Alt+2`), on routes with a panel. On phones the panel is a bottom sheet and
 * the button says whether it is open (`aria-expanded`).
 */
export function RightPaneToggle({ collapsed, sheet }: { collapsed: boolean; sheet: boolean }) {
  const { t } = useTranslation();
  const label = collapsed ? t('panes.showRight') : t('panes.hideRight');
  return (
    <button
      type="button"
      className="icon-button icon-button--mirrored"
      aria-label={label}
      aria-expanded={sheet ? !collapsed : undefined}
      aria-controls={sheet && !collapsed ? PANEL_SHEET_ID : undefined}
      title={t('panes.withShortcut', { label, keys: shortcutKeys('toggle-right-pane') })}
      onClick={() => usePanesStore.getState().toggleRight()}
    >
      <SidebarSimple size={18} aria-hidden="true" focusable="false" />
    </button>
  );
}
