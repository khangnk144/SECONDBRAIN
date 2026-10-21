import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { NOTE_ROUTE, setAppNavigator } from '../lib/app-navigation';
import { useRecentNotes } from '../lib/recent-notes-store';
import { useTabsStore } from '../lib/tabs-store';

/**
 * Keeps `#/note?path=` and the active tab in step: stores navigate through the registered
 * navigator; a route change (deep link, back/forward) is mirrored into the tabs once the saved
 * tabs of the vault are loaded. Every note the route shows is recorded as recently opened.
 */
export function useTabsRouteSync(): void {
  const navigate = useNavigate();
  const location = useLocation();
  const hydrated = useTabsStore((state) => state.hydrated);

  useEffect(() => setAppNavigator((to, options) => void navigate(to, options)), [navigate]);

  useEffect(() => {
    const onNote = location.pathname === NOTE_ROUTE;
    const tabs = useTabsStore.getState();
    tabs.setRouteActive(onNote);
    if (!onNote || !hydrated) return;
    const path = new URLSearchParams(location.search).get('path');
    if (!path) return;
    tabs.syncFromRoute(path);
    useRecentNotes.getState().record(path);
  }, [location.pathname, location.search, hydrated]);
}
