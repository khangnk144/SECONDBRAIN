import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-client';
import { getNote } from '../../lib/api/notes-api';
import type { NoteResponse } from '../../lib/api/notes-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { debounce } from '../../lib/debounce';
import type { ClientEvent } from '../../lib/ws/server-event-types';
import { useServerEvent } from '../../lib/ws/use-server-event';

/** Saves often come in bursts (autosave, relink of several notes): refetch once they settle. */
export const PANEL_REFRESH_MS = 200;

export type PanelNoteState =
  | { status: 'loading' }
  | { status: 'ready'; note: NoteResponse }
  | { status: 'error'; notFound: boolean };

/** Any change in the vault can add or remove a backlink, so every note event counts. */
export function isVaultChange(event: ClientEvent): boolean {
  return (
    event.type.startsWith('note:') || event.type === 'folder:changed' || event.type === 'resync'
  );
}

/**
 * `GET /note` for the right panel (backlinks, outline). Refetches shortly after any vault change
 * pushed over the WebSocket and after a reconnect; a failed refetch keeps what is on screen
 * unless the note itself is gone.
 */
export function usePanelNote(path: VaultPath | null) {
  const [state, setState] = useState<PanelNoteState>({ status: 'loading' });
  const latestPath = useRef(path);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const target = latestPath.current;
    if (!target) return;
    const id = ++sequence.current;
    try {
      const note = await getNote(target);
      if (id === sequence.current) setState({ status: 'ready', note });
    } catch (error) {
      if (id !== sequence.current) return;
      const notFound = isApiError(error, 'NOT_FOUND');
      setState((previous) =>
        previous.status === 'ready' && !notFound ? previous : { status: 'error', notFound },
      );
    }
  }, []);

  useEffect(() => {
    latestPath.current = path;
    setState({ status: 'loading' });
    void load();
  }, [path, load]);

  const refresh = useMemo(() => debounce(() => void load(), PANEL_REFRESH_MS), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useServerEvent('*', (event) => {
    if (isVaultChange(event)) refresh.schedule();
  });

  return { state, reload: load };
}
