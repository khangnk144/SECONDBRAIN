/**
 * The AI status every AI surface reads (chat, editor actions, palette, Settings, Today): whether AI
 * may be used now and why not, the retrieval mode, embedding progress and this month's usage.
 * Refetched on `ai:status` (settings, budget and embedding progress changes), `settings:changed`,
 * a reconnect (`resync`) and when the window comes back into view. Written by the lead for M6.
 */
import { create } from 'zustand';
import { getAiStatus } from './api/ai-api';
import type { AiStatus } from './api/ai-types';
import { debounce } from './debounce';
import { subscribeServerEvent } from './ws/server-event-bus';

export const AI_STATUS_REFRESH_DEBOUNCE_MS = 200;

interface AiStatusState {
  /** Null until the first answer (surfaces show nothing AI-specific meanwhile). */
  status: AiStatus | null;
  load: () => Promise<void>;
}

let loadSeq = 0;

export const useAiStatusStore = create<AiStatusState>((set) => ({
  status: null,
  load: async () => {
    const seq = ++loadSeq;
    try {
      const status = await getAiStatus();
      if (seq === loadSeq) set({ status });
    } catch {
      // Keep what is shown; the next event or focus retries.
    }
  },
}));

/** True when AI may be used right now (enabled, consented, key, budget). */
export function useAiReady(): boolean {
  return useAiStatusStore((state) => state.status?.ready === true);
}

/** Never sent, whatever the scope says (server `ai-scope.ts`: template and attachment classes). */
const NEVER_SENT_FOLDERS = ['templates', 'attachments'];
/** Control docs that are not knowledge to answer from (`wiki/index.md` is, the catalog). */
const NEVER_SENT_DOCS = ['claude.md', 'wiki/log.md'];

/**
 * Whether a vault path lies in the folders AI may read (same rule as the server's scope): `''` =
 * notes at the vault root, any other entry a folder and everything below it (the scope may name
 * subfolders); compared NFC- and case-insensitively, like Windows does.
 */
export function isInAiScope(status: AiStatus | null, path: string): boolean {
  if (!status) return false;
  const fold = (value: string) => value.normalize('NFC').toLowerCase();
  const folded = fold(path);
  const slash = folded.indexOf('/');
  const top = slash === -1 ? '' : folded.slice(0, slash);
  if (NEVER_SENT_FOLDERS.includes(top) || NEVER_SENT_DOCS.includes(folded)) return false;
  return status.scope.some((folder) =>
    folder === '' ? top === '' : folded.startsWith(`${fold(folder).replace(/\/+$/, '')}/`),
  );
}

export function startAiStatusSync(): () => void {
  const debounced = debounce(
    () => void useAiStatusStore.getState().load(),
    AI_STATUS_REFRESH_DEBOUNCE_MS,
  );
  const refresh = () => debounced.schedule();
  const stops = [
    subscribeServerEvent('ai:status', refresh),
    subscribeServerEvent('settings:changed', refresh),
    subscribeServerEvent('resync', refresh),
  ];
  const onVisible = () => {
    if (document.visibilityState === 'visible') refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  void useAiStatusStore.getState().load();
  return () => {
    for (const stop of stops) stop();
    document.removeEventListener('visibilitychange', onVisible);
    debounced.cancel();
  };
}

export function resetAiStatusStore(): void {
  loadSeq += 1;
  useAiStatusStore.setState({ status: null });
}
