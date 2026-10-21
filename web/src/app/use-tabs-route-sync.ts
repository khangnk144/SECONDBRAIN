import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { FILE_ROUTE, NOTE_ROUTE, setAppNavigator } from '../lib/app-navigation';
import { useRecentNotes } from '../lib/recent-notes-store';
import { useTabsStore, type TabKind } from '../lib/tabs-store';

/** The tab kind a route shows, or null for screens without tabs. */
function tabKindOf(pathname: string): TabKind | null {
  if (pathname === NOTE_ROUTE) return 'note';
  if (pathname === FILE_ROUTE) return 'file';
  return null;
}

/**
 * Keeps `#/note?path=` / `#/file?path=` and the active tab in step: stores navigate through the
 * registered navigator; a route change (deep link, back/forward) is mirrored into the tabs once
 * the saved tabs of the vault are loaded. Every note the route shows is recorded as recently
 * opened.
 */
export function useTabsRouteSync(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const hydrated = useTabsStore((state) => state.hydrated);

  useEffect(() => setAppNavigator((to, options) => void navigate(to, options)), [navigate]);

  useEffect(() => {
    const kind = tabKindOf(location.pathname);
    const tabs = useTabsStore.getState();
    tabs.setRouteActive(kind !== null);
    if (kind === null || !hydrated) return;
    const path = new URLSearchParams(location.search).get('path');
    if (!path) return;
    tabs.syncFromRoute(path, kind);
    if (kind === 'note') useRecentNotes.getState().record(path);
  }, [location.pathname, location.search, hydrated]);
}
