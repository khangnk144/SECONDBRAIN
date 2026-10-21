import { SidebarSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../lib/panes-store';
import { shortcutKeys } from '../lib/shortcuts/use-app-shortcuts';
import { TabBar } from '../features/tabs/tab-bar';

/**
 * Row above the screen: pane toggles (the visible equivalents of `Alt+1` / `Alt+2`) and, on the
 * note route, the tab bar between them. The collapsed flags are what is on screen (an immersive
 * route hides the panes without changing the stored preference).
 */
export function MainToolbar({
  showTabs,
  routeHasPanel,
  leftCollapsed,
  rightCollapsed,
}: {
  showTabs: boolean;
  routeHasPanel: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
}) {
  const { t } = useTranslation();
  const { toggleLeft, toggleRight } = usePanesStore.getState();
  const leftLabel = leftCollapsed ? t('panes.showLeft') : t('panes.hideLeft');
  const rightLabel = rightCollapsed ? t('panes.showRight') : t('panes.hideRight');

  return (
    <div className="main-toolbar">
      <button
        type="button"
        className="icon-button"
        aria-label={leftLabel}
        title={t('panes.withShortcut', {
          label: leftLabel,
          keys: shortcutKeys('toggle-left-pane'),
        })}
        onClick={toggleLeft}
      >
        <SidebarSimple size={18} aria-hidden="true" focusable="false" />
      </button>
      {showTabs ? <TabBar /> : <span className="main-toolbar__spacer" />}
      {routeHasPanel ? (
        <button
          type="button"
          className="icon-button icon-button--mirrored"
          aria-label={rightLabel}
          title={t('panes.withShortcut', {
            label: rightLabel,
            keys: shortcutKeys('toggle-right-pane'),
          })}
          onClick={toggleRight}
        >
          <SidebarSimple size={18} aria-hidden="true" focusable="false" />
        </button>
      ) : null}
    </div>
  );
}
