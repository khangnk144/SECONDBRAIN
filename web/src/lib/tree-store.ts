import { create } from 'zustand';
import { getTree } from './api/tree-api';
import type { VaultTree } from './api/tree-types';
import type { VaultPath } from './api/vault-types';
import { debounce } from './debounce';
import { vaultStorage } from './vault-storage';
import { pathKey, replacePathPrefix } from './vault-paths';
import { subscribeServerEvent } from './ws/server-event-bus';

export const TREE_REFRESH_DEBOUNCE_MS = 150;
const STORAGE_KEY = 'tree.expanded';
/** First run: show what is new (Inbox) and what is in progress (Projects). */
const DEFAULT_EXPANDED = ['0 Inbox', '1 Projects'];

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface TreeState {
  tree: VaultTree | null;
  status: LoadStatus;
  /** Expanded folder paths, remembered per vault. */
  expanded: VaultPath[];
  fetchTree: () => Promise<void>;
  /** Refetches once things settle (bursts of file events cause one request). */
  scheduleRefresh: () => void;
  hydrate: () => void;
  setExpanded: (path: VaultPath, expanded: boolean) => void;
  toggleExpanded: (path: VaultPath) => void;
  /** Keeps expanded state when a folder is renamed or moved. */
  renameExpanded: (oldPath: VaultPath, newPath: VaultPath) => void;
}

let requestSeq = 0;

export function isExpanded(expanded: readonly VaultPath[], path: VaultPath): boolean {
  const key = pathKey(path);
  return expanded.some((p) => pathKey(p) === key);
}

export const useTreeStore = create<TreeState>((set, get) => {
  const refresh = debounce(() => void get().fetchTree(), TREE_REFRESH_DEBOUNCE_MS);

  function saveExpanded(expanded: VaultPath[]) {
    set({ expanded });
    vaultStorage.set(STORAGE_KEY, expanded);
  }

  return {
    tree: null,
    status: 'idle',
    expanded: [],
    fetchTree: async () => {
      const seq = ++requestSeq;
      if (get().tree === null) set({ status: 'loading' });
      try {
        const tree = await getTree();
        // A slower, older request must not overwrite a newer answer.
        if (seq === requestSeq) set({ tree, status: 'ready' });
      } catch {
        if (seq === requestSeq) set({ status: get().tree ? 'ready' : 'error' });
      }
    },
    scheduleRefresh: () => refresh.schedule(),
    hydrate: () => {
      const stored = vaultStorage.get<unknown>(STORAGE_KEY, null);
      const expanded = Array.isArray(stored)
        ? stored.filter((p): p is string => typeof p === 'string')
        : DEFAULT_EXPANDED;
      set({ expanded });
    },
    setExpanded: (path, value) => {
      const { expanded } = get();
      if (isExpanded(expanded, path) === value) return;
      const key = pathKey(path);
      saveExpanded(value ? [...expanded, path] : expanded.filter((p) => pathKey(p) !== key));
    },
    toggleExpanded: (path) => get().setExpanded(path, !isExpanded(get().expanded, path)),
    renameExpanded: (oldPath, newPath) => {
      saveExpanded(get().expanded.map((p) => replacePathPrefix(p, oldPath, newPath)));
    },
  };
});

/** Refetches the tree after file, folder, rebuild and reconnect events. Returns unsubscribe. */
export function startTreeSync(): () => void {
  const refresh = () => useTreeStore.getState().scheduleRefresh();
  const unsubscribers = [
    subscribeServerEvent('note:changed', refresh),
    subscribeServerEvent('note:created', refresh),
    subscribeServerEvent('note:deleted', refresh),
    subscribeServerEvent('note:renamed', refresh),
    subscribeServerEvent('folder:changed', refresh),
    subscribeServerEvent('resync', refresh),
    subscribeServerEvent('index:progress', (event) => {
      if (event.phase === 'done') refresh();
    }),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}
