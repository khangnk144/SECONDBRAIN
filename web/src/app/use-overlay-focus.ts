import { useEffect, type RefObject } from 'react';
import { currentRoute } from '../lib/app-navigation';
import { focusableElements } from '../features/dialogs/use-focus-trap';
import { focusIsLost } from '../lib/focus-recovery';

function routeId(): string | null {
  const route = currentRoute();
  return route ? `${route.pathname}?${route.search}` : null;
}

/**
 * Focus of a shell drawer/sheet: on open it moves to the first control of the content (the tree,
 * the first link), else of the panel; on close it goes back to where it was (the rail button,
 * the toolbar toggle) when it would otherwise be lost. When a navigation closed the overlay (a
 * note opened from the folder drawer) focus is left to the new screen (`useFocusRecovery`).
 */
export function useOverlayFocus(panelRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const routeAtOpen = routeId();
    const body = panel.querySelector<HTMLElement>('.shell-overlay__body');
    const first = (body && focusableElements(body)[0]) ?? focusableElements(panel)[0] ?? panel;
    first.focus();
    return () => {
      if (routeId() !== routeAtOpen) return;
      const now = document.activeElement;
      const inside = focusIsLost() || (now instanceof Node && panel.contains(now));
      if (inside && opener?.isConnected) opener.focus();
    };
  }, [panelRef]);
}
