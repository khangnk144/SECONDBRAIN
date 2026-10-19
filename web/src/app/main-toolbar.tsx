import { SidebarSimple } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { usePanesStore } from '../lib/panes-store';
import { TabBar } from '../features/tabs/tab-bar';

/**
 * Row above the screen: pane toggles (the visible equivalents of `Alt+1` / `Alt+2`) and, on the
 * note route, the tab bar between them.
 */
export function MainToolbar({
  showTabs,
  routeHasPanel,
}: {
  showTabs: boolean;
  routeHasPanel: boolean;
}) {
  const { t } = useTranslation();
  const leftCollapsed = usePanesStore((state) => state.leftCollapsed);
  const rightCollapsed = usePanesStore((state) => state.rightCollapsed);
  const { toggleLeft, toggleRight } = usePanesStore.getState();
  const leftLabel = leftCollapsed ? t('panes.showLeft') : t('panes.hideLeft');
  const rightLabel = rightCollapsed ? t('panes.showRight') : t('panes.hideRight');

  return (
    <div className="main-toolbar">
      <button
        type="button"
        className="icon-button"
        aria-label={leftLabel}
        title={t('panes.withShortcut', { label: leftLabel, keys: 'Alt+1' })}
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
          title={t('panes.withShortcut', { label: rightLabel, keys: 'Alt+2' })}
          onClick={toggleRight}
        >
          <SidebarSimple size={18} aria-hidden="true" focusable="false" />
        </button>
      ) : null}
    </div>
  );
}
