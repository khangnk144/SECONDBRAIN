/** Saved tabs per vault (`sb:<vaultId>:tabs`), validated on the way back in. */
import type { VaultPath } from './api/vault-types';
import { vaultStorage } from './vault-storage';

export interface NoteTab {
  id: string;
  path: VaultPath;
  /** Monotonic counter: higher = used more recently (picks the tab to replace at the limit). */
  lastActive: number;
}

export interface SavedTabs {
  tabs: NoteTab[];
  activeId: string | null;
}

const STORAGE_KEY = 'tabs';

function isTab(value: unknown): value is NoteTab {
  if (value === null || typeof value !== 'object') return false;
  const tab = value as Record<string, unknown>;
  return (
    typeof tab.id === 'string' &&
    typeof tab.path === 'string' &&
    tab.path !== '' &&
    typeof tab.lastActive === 'number' &&
    Number.isFinite(tab.lastActive)
  );
}

export function loadTabs(max: number): SavedTabs {
  const stored = vaultStorage.get<unknown>(STORAGE_KEY, null);
  if (stored === null || typeof stored !== 'object') return { tabs: [], activeId: null };
  const raw = stored as { tabs?: unknown; activeId?: unknown };
  const seen = new Set<string>();
  const tabs = (Array.isArray(raw.tabs) ? raw.tabs : [])
    .filter(isTab)
    .filter((tab) => !seen.has(tab.id) && seen.add(tab.id))
    .slice(0, max)
    .map(({ id, path, lastActive }) => ({ id, path, lastActive }));
  const activeId =
    typeof raw.activeId === 'string' && tabs.some((tab) => tab.id === raw.activeId)
      ? raw.activeId
      : (tabs[0]?.id ?? null);
  return { tabs, activeId };
}

export function saveTabs(state: SavedTabs): void {
  vaultStorage.set(STORAGE_KEY, { tabs: state.tabs, activeId: state.activeId });
}
