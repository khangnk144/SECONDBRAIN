import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { NOTE_ROUTE } from '../lib/app-navigation';
import { focusIsLost, focusMainRegion, recoverFocusAfterNavigation } from '../lib/focus-recovery';

/**
 * Focus never falls to `<body>`:
 * - after a route change (Alt+[ / Alt+] / Alt+W from the editor), focus goes to the new note's
 *   editor, else the active tab, else the main region;
 * - when a side pane that held focus collapses (Alt+1 / Alt+2), focus goes to the main region.
 * The first render is left alone, so loading the app does not move focus.
 */
export function useFocusRecovery(leftCollapsed: boolean, rightCollapsed: boolean): void {
  const location = useLocation();
  const firstNavigation = useRef(true);
  useEffect(() => {
    if (firstNavigation.current) {
      firstNavigation.current = false;
      return;
    }
    return recoverFocusAfterNavigation({ expectEditor: location.pathname === NOTE_ROUTE });
  }, [location.key, location.pathname]);

  const panes = useRef({ leftCollapsed, rightCollapsed });
  useEffect(() => {
    const before = panes.current;
    panes.current = { leftCollapsed, rightCollapsed };
    const collapsed =
      (leftCollapsed && !before.leftCollapsed) || (rightCollapsed && !before.rightCollapsed);
    if (collapsed && focusIsLost()) focusMainRegion();
  }, [leftCollapsed, rightCollapsed]);
}
