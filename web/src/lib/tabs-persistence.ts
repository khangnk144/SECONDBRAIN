/** Saved tabs per vault (`sb:<vaultId>:tabs`), validated on the way back in. */
import type { VaultPath } from './api/vault-types';
import { vaultStorage } from './vault-storage';

/** `note`: the editor (`/note`); `file`: the in-app viewer of a vault file (`/file`, PDFs). */
export type TabKind = 'note' | 'file';

export interface AppTab {
  id: string;
  /** Absent = a note tab (tabs made before file tabs existed, and older callers). */
  kind?: TabKind;
  path: VaultPath;
  /** Monotonic counter: higher = used more recently (picks the tab to replace at the limit). */
  lastActive: number;
}

/** Older name of `AppTab` (every tab was a note tab before the viewer existed). */
export type NoteTab = AppTab;

export function tabKind(tab: Pick<AppTab, 'kind'>): TabKind {
  return tab.kind === 'file' ? 'file' : 'note';
}

export interface SavedTabs {
  tabs: AppTab[];
  activeId: string | null;
}

const STORAGE_KEY = 'tabs';

/**
 * A saved tab, or null. Tabs saved before tabs had a kind have none and are notes; a kind this
 * build does not know is dropped rather than guessed.
 */
function toTab(value: unknown): AppTab | null {
  if (value === null || typeof value !== 'object') return null;
  const tab = value as Record<string, unknown>;
  const kind = tab.kind === undefined ? 'note' : tab.kind;
  if (kind !== 'note' && kind !== 'file') return null;
  if (typeof tab.id !== 'string' || typeof tab.path !== 'string' || tab.path === '') return null;
  if (typeof tab.lastActive !== 'number' || !Number.isFinite(tab.lastActive)) return null;
  return { id: tab.id, kind, path: tab.path, lastActive: tab.lastActive };
}

export function loadTabs(max: number): SavedTabs {
  const stored = vaultStorage.get<unknown>(STORAGE_KEY, null);
  if (stored === null || typeof stored !== 'object') return { tabs: [], activeId: null };
  const raw = stored as { tabs?: unknown; activeId?: unknown };
  const seen = new Set<string>();
  const tabs = (Array.isArray(raw.tabs) ? raw.tabs : [])
    .map(toTab)
    .filter((tab): tab is AppTab => tab !== null && !seen.has(tab.id) && Boolean(seen.add(tab.id)))
    .slice(0, max);
  const activeId =
    typeof raw.activeId === 'string' && tabs.some((tab) => tab.id === raw.activeId)
      ? raw.activeId
      : (tabs[0]?.id ?? null);
  return { tabs, activeId };
}

export function saveTabs(state: SavedTabs): void {
  vaultStorage.set(STORAGE_KEY, { tabs: state.tabs, activeId: state.activeId });
}
