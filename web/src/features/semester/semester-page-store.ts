/**
 * What this window knows about the "Học kỳ này" page of the open vault: Settings, the note screen
 * (read-only banner) and the palette command read it. Loaded on first use; components that show
 * it keep it fresh while mounted (`useSemesterPageStatus`): a change of the page's own file, a
 * folder change, a reconnect or a finished rebuild reloads it. A status of another vault is
 * never used.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import type { VaultPath } from '../../lib/api/vault-types';
import { debounce } from '../../lib/debounce';
import { samePath } from '../../lib/vault-paths';
import { useVaultStore } from '../../lib/vault-store';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import type { ClientEvent } from '../../lib/ws/server-event-types';
import {
  getSemesterPage,
  postSemesterPage,
  type SemesterAction,
  type SemesterActionResult,
  type SemesterPageStatus,
} from './semester-api';

/** A status older than this is asked again when the palette looks at it. */
export const SEMESTER_STATUS_MAX_AGE_MS = 10_000;
const RELOAD_DEBOUNCE_MS = 150;

interface SemesterPageStore {
  vaultId: string | null;
  status: SemesterPageStatus | null;
  loadedAt: number;
  load: () => Promise<void>;
  act: (action: SemesterAction) => Promise<SemesterActionResult>;
}

let loadSeq = 0;
const currentVault = () => useVaultStore.getState().vaultId;

export const useSemesterPageStore = create<SemesterPageStore>((set) => ({
  vaultId: null,
  status: null,
  loadedAt: 0,
  async load() {
    const seq = ++loadSeq;
    const vaultId = currentVault();
    try {
      const status = await getSemesterPage();
      if (seq === loadSeq) set({ vaultId, status, loadedAt: Date.now() });
    } catch {
      // Keep what is shown; the next event or visit asks again.
    }
  },
  async act(action) {
    const vaultId = currentVault();
    const result = await postSemesterPage(action);
    loadSeq += 1; // an older load must not overwrite this answer
    set({ vaultId, status: result.status, loadedAt: Date.now() });
    return result;
  },
}));

/** The status for the open vault, or null when unknown. */
export function currentSemesterStatus(): SemesterPageStatus | null {
  const { vaultId, status } = useSemesterPageStore.getState();
  return vaultId !== null && vaultId === currentVault() ? status : null;
}

/** The page's path when it is on and its file exists (the palette command), else null. */
export function openableSemesterPage(): VaultPath | null {
  const { loadedAt } = useSemesterPageStore.getState();
  const status = currentSemesterStatus();
  if (status === null || Date.now() - loadedAt > SEMESTER_STATUS_MAX_AGE_MS) {
    void useSemesterPageStore.getState().load();
  }
  return status?.enabled && status.exists ? status.path : null;
}

function touchesPage(event: ClientEvent, status: SemesterPageStatus | null): boolean {
  switch (event.type) {
    case 'note:changed':
    case 'note:created':
    case 'note:deleted':
      return status !== null && samePath(event.path, status.path);
    case 'note:renamed':
      return (
        status !== null &&
        (samePath(event.path, status.path) || samePath(event.oldPath, status.path))
      );
    case 'folder:changed':
    case 'resync':
      return true;
    case 'index:progress':
      return event.phase === 'done';
    default:
      return false;
  }
}

/** Loads the status on mount and keeps it fresh while the component is on screen. */
export function useSemesterPageStatus(): SemesterPageStatus | null {
  const vaultId = useVaultStore((state) => state.vaultId);
  const status = useSemesterPageStore((state) =>
    state.vaultId !== null && state.vaultId === vaultId ? state.status : null,
  );
  useEffect(() => {
    if (vaultId === null) return;
    const reload = debounce(() => void useSemesterPageStore.getState().load(), RELOAD_DEBOUNCE_MS);
    void useSemesterPageStore.getState().load();
    const stop = subscribeServerEvent('*', (event) => {
      if (touchesPage(event, currentSemesterStatus())) reload.schedule();
    });
    return () => {
      reload.cancel();
      stop();
    };
  }, [vaultId]);
  return status;
}

/** Test helper. */
export function resetSemesterPageStore(): void {
  loadSeq += 1;
  useSemesterPageStore.setState({ vaultId: null, status: null, loadedAt: 0 });
}
