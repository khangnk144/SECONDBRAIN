/**
 * Recently opened notes, most recent first, remembered per vault (`sb:<vaultId>:recent-notes`).
 * The palette shows them for an empty query (SPEC F8). A note is recorded each time the note
 * route shows it; renames are followed and deletions dropped through the WebSocket events.
 */
import { create } from 'zustand';
import type { VaultPath } from './api/vault-types';
import { vaultStorage } from './vault-storage';
import { samePath } from './vault-paths';
import { subscribeServerEvent } from './ws/server-event-bus';

export const MAX_RECENT_NOTES = 50;
const STORAGE_KEY = 'recent-notes';

interface RecentNotesState {
  paths: VaultPath[];
  /** Reads the list saved for the current vault. */
  hydrate: () => void;
  /** Moves `path` to the front (adding it when new). */
  record: (path: VaultPath) => void;
  rename: (oldPath: VaultPath, newPath: VaultPath) => void;
  remove: (path: VaultPath) => void;
}

function commit(paths: VaultPath[]): { paths: VaultPath[] } {
  const kept = paths.slice(0, MAX_RECENT_NOTES);
  vaultStorage.set(STORAGE_KEY, kept);
  return { paths: kept };
}

/** Distinct paths (same file = same NFC/lowercase key), first spelling kept. */
function distinct(paths: VaultPath[]): VaultPath[] {
  const out: VaultPath[] = [];
  for (const path of paths) if (!out.some((p) => samePath(p, path))) out.push(path);
  return out;
}

export const useRecentNotes = create<RecentNotesState>((set, get) => ({
  paths: [],
  hydrate: () => {
    const stored = vaultStorage.get<unknown>(STORAGE_KEY, []);
    const paths = Array.isArray(stored)
      ? stored.filter((p): p is string => typeof p === 'string' && p !== '')
      : [];
    set({ paths: distinct(paths).slice(0, MAX_RECENT_NOTES) });
  },
  record: (path) => {
    const { paths } = get();
    if (paths[0] === path) return;
    set(commit([path, ...paths.filter((p) => !samePath(p, path))]));
  },
  rename: (oldPath, newPath) => {
    const { paths } = get();
    if (!paths.some((p) => samePath(p, oldPath))) return;
    set(commit(distinct(paths.map((p) => (samePath(p, oldPath) ? newPath : p)))));
  },
  remove: (path) => {
    const { paths } = get();
    if (!paths.some((p) => samePath(p, path))) return;
    set(commit(paths.filter((p) => !samePath(p, path))));
  },
}));

/** The `limit` most recently opened notes, newest first. */
export function recentNotePaths(limit = MAX_RECENT_NOTES): VaultPath[] {
  return useRecentNotes.getState().paths.slice(0, Math.max(0, limit));
}

/** Follows renames (folder moves arrive as one event per file) and drops deleted notes. */
export function startRecentNotesSync(): () => void {
  const stops = [
    subscribeServerEvent('note:renamed', (event) =>
      useRecentNotes.getState().rename(event.oldPath, event.path),
    ),
    subscribeServerEvent('note:deleted', (event) => useRecentNotes.getState().remove(event.path)),
  ];
  return () => stops.forEach((stop) => stop());
}
