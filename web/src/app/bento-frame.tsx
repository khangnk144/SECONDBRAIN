import { useRef } from 'react';
import { Outlet, useLocation } from 'react-router';
import { ConnectionBanner } from '../features/connection/connection-banner';
import { JournalBanner } from '../features/journal/journal-banner';
import { TabBar } from '../features/tabs/tab-bar';
import { BentoTopBar } from './bento-top-bar';
import { FolderDrawer, FolderPane, FOLDER_PANE_ID } from './folder-pane';
import type { FrameProps } from './frame-props';
import { LEFT_DRAWER_ID } from './pane-toggles';
import { BottomTabBar } from './rail/bottom-tab-bar';
import { Rail } from './rail/rail';
import { PanelSheet, RoutePanel } from './route-panel';
import { useScreenHasPrimary } from './use-screen-primary';

/**
 * "Bento mềm" (design.md §12.2): the rail (a bottom tab bar on phones), the "Thư mục" pane on
 * note and file routes (a drawer elsewhere), the main column – top bar, banners, the tab row on
 * note routes, the routed screen – and the right panel, its sections as tiles.
 */
export function BentoFrame({ handle, view, compact, screenKey, rightCollapsed }: FrameProps) {
  const columnRef = useRef<HTMLDivElement>(null);
  const screenHasPrimary = useScreenHasPrimary(columnRef, useLocation().key);
  const folderExpanded = view.leftInline || view.drawer;
  const folderControls = view.leftInline ? FOLDER_PANE_ID : LEFT_DRAWER_ID;
  return (
    <>
      {compact ? null : <Rail folderExpanded={folderExpanded} folderControls={folderControls} />}
      {view.leftInline ? <FolderPane /> : null}
      <div ref={columnRef} className="bento-column">
        <main id="main-content" className="app-main" tabIndex={-1}>
          <BentoTopBar
            screenHasPrimary={screenHasPrimary}
            routeHasPanel={handle.rightPanel === true}
            rightCollapsed={rightCollapsed}
            compact={compact}
          />
          {handle.inlineConnectionBanner === true ? null : <ConnectionBanner variant="global" />}
          <JournalBanner />
          {handle.tabs === true ? (
            <div className="bento-tabs">
              <TabBar />
            </div>
          ) : null}
          <div key={screenKey} className="app-main__inner">
            <Outlet />
          </div>
        </main>
        {view.right === 'side' ? <RoutePanel panel={handle.panel} /> : null}
      </div>
      {view.drawer ? <FolderDrawer /> : null}
      {view.right === 'sheet' ? <PanelSheet panel={handle.panel} /> : null}
      {compact ? <BottomTabBar folderExpanded={folderExpanded} /> : null}
    </>
  );
}
