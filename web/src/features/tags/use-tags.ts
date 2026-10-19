import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getTags } from '../../lib/api/search-api';
import type { TagCount } from '../../lib/api/search-types';
import { debounce } from '../../lib/debounce';
import { useServerEvent } from '../../lib/ws/use-server-event';
import { isVaultChange, PANEL_REFRESH_MS } from '../backlinks/use-panel-note';

export type TagsState =
  { status: 'loading' } | { status: 'ready'; tags: TagCount[] } | { status: 'error' };

/** `GET /tags`, refetched shortly after vault changes and after a reconnect. */
export function useTags() {
  const [state, setState] = useState<TagsState>({ status: 'loading' });
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const id = ++sequence.current;
    try {
      const { tags } = await getTags();
      if (id === sequence.current) setState({ status: 'ready', tags });
    } catch {
      // A failed refresh keeps the list on screen.
      if (id === sequence.current) {
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'error' }));
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useMemo(() => debounce(() => void load(), PANEL_REFRESH_MS), [load]);
  useEffect(() => () => refresh.cancel(), [refresh]);
  useServerEvent('*', (event) => {
    if (isVaultChange(event)) refresh.schedule();
  });

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void load();
  }, [load]);

  return { state, retry };
}
