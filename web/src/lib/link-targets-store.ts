import { create } from 'zustand';
import { getLinkTargets } from './api/link-targets-api';
import type { LinkTargetFile, LinkTargetNote } from './api/link-targets-types';
import type { VaultPath } from './api/vault-types';
import { debounce } from './debounce';
import {
  buildLinkCatalog,
  resolveLinkTarget,
  type LinkCatalog,
  type LinkKind,
  type LinkResolution,
} from './link-resolution';
import type { LoadStatus } from './tree-store';
import { subscribeServerEvent } from './ws/server-event-bus';

export const LINK_TARGETS_REFRESH_DEBOUNCE_MS = 150;

interface LinkTargetsState {
  /** Every linkable note (for `[[` autocomplete): title, folder and whether the title is unique. */
  titles: LinkTargetNote[];
  /** Non-note files (for `![[…]]`). */
  files: LinkTargetFile[];
  catalog: LinkCatalog;
  status: LoadStatus;
  fetchTargets: () => Promise<void>;
  scheduleRefresh: () => void;
  /** Same answer the server gives for a link written in `fromPath` (ghost/ambiguous rendering). */
  resolve: (target: string, fromPath: VaultPath, kind?: LinkKind) => LinkResolution;
  /** Replaces the data directly (tests, or a caller that already fetched it). */
  setTargets: (notes: LinkTargetNote[], files: LinkTargetFile[]) => void;
}

let requestSeq = 0;

export const useLinkTargetsStore = create<LinkTargetsState>((set, get) => {
  const refresh = debounce(() => void get().fetchTargets(), LINK_TARGETS_REFRESH_DEBOUNCE_MS);
  return {
    titles: [],
    files: [],
    catalog: buildLinkCatalog([]),
    status: 'idle',
    fetchTargets: async () => {
      const seq = ++requestSeq;
      if (get().status === 'idle') set({ status: 'loading' });
      try {
        const { notes, files } = await getLinkTargets();
        if (seq === requestSeq) get().setTargets(notes, files);
      } catch {
        if (seq === requestSeq && get().status !== 'ready') set({ status: 'error' });
      }
    },
    scheduleRefresh: () => refresh.schedule(),
    resolve: (target, fromPath, kind) => resolveLinkTarget(get().catalog, target, fromPath, kind),
    setTargets: (notes, files) =>
      set({
        titles: notes,
        files,
        catalog: buildLinkCatalog([...notes.map((n) => n.path), ...files.map((f) => f.path)]),
        status: 'ready',
      }),
  };
});

/** Content edits never change titles; only events that add, remove or move files matter. */
export function startLinkTargetsSync(): () => void {
  const refresh = () => useLinkTargetsStore.getState().scheduleRefresh();
  const unsubscribers = [
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
