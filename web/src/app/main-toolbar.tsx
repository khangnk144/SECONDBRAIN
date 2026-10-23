import { TabBar } from '../features/tabs/tab-bar';
import { LeftPaneToggle, RightPaneToggle } from './pane-toggles';

/**
 * Row above the screen (calm): pane toggles (the visible equivalents of `Alt+1` / `Alt+2`) and,
 * on the note route, the tab bar between them. The collapsed flags are what is on screen (an
 * immersive route hides the panes without changing the stored preference). On phones
 * (`compact`) the left toggle opens the sidebar drawer and the right one the panel sheet.
 */
export function MainToolbar({
  showTabs,
  routeHasPanel,
  leftCollapsed,
  rightCollapsed,
  compact = false,
}: {
  showTabs: boolean;
  routeHasPanel: boolean;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  compact?: boolean;
}) {
  return (
    <div className="main-toolbar">
      <LeftPaneToggle collapsed={leftCollapsed} drawer={compact} />
      {showTabs ? <TabBar /> : <span className="main-toolbar__spacer" />}
      {routeHasPanel ? <RightPaneToggle collapsed={rightCollapsed} sheet={compact} /> : null}
    </div>
  );
}
