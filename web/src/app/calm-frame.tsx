import { Outlet } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ConnectionBanner } from '../features/connection/connection-banner';
import { JournalBanner } from '../features/journal/journal-banner';
import { usePanesStore } from '../lib/panes-store';
import { LeftSidebar } from './left-sidebar';
import { MainToolbar } from './main-toolbar';
import { LEFT_DRAWER_ID } from './pane-toggles';
import { PanelSheet, RoutePanel } from './route-panel';
import { ShellOverlay } from './shell-overlay';
import type { FrameProps } from './frame-props';

/**
 * "Yên tĩnh" (calm): the three-pane frame of design.md §4 – left sidebar, main content, optional
 * right panel. On phones (≤ 600 px) the sidebar is a drawer behind the toolbar's menu button and
 * the right panel a bottom sheet (F28.1); wider windows are exactly as before.
 */
export function CalmFrame({
  handle,
  view,
  compact,
  screenKey,
  leftCollapsed,
  rightCollapsed,
}: FrameProps) {
  const { t } = useTranslation();
  return (
    <>
      {view.leftInline ? <LeftSidebar /> : null}
      <main id="main-content" className="app-main" tabIndex={-1}>
        {handle.inlineConnectionBanner === true ? null : <ConnectionBanner variant="global" />}
        <JournalBanner />
        <MainToolbar
          showTabs={handle.tabs === true}
          routeHasPanel={handle.rightPanel === true}
          leftCollapsed={leftCollapsed}
          rightCollapsed={rightCollapsed}
          compact={compact}
        />
        <div key={screenKey} className="app-main__inner">
          <Outlet />
        </div>
      </main>
      {view.right === 'side' ? <RoutePanel panel={handle.panel} /> : null}
      {view.drawer ? (
        <ShellOverlay
          id={LEFT_DRAWER_ID}
          side="left"
          label={t('rail.menu')}
          className="sidebar-drawer"
          onClose={() => usePanesStore.getState().closeDrawer()}
        >
          <LeftSidebar />
        </ShellOverlay>
      ) : null}
      {view.right === 'sheet' ? <PanelSheet panel={handle.panel} /> : null}
    </>
  );
}
