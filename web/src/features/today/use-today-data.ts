/**
 * Today's data for both styles (calm and Bento): `GET /today` through the live query, the rows
 * ticked during this visit kept on screen (today-kept-items.ts), and the optimistic changes after
 * a confirmed tick or "Đánh dấu xong" (today-optimistic.ts). One copy of the logic, whichever
 * layout shows it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getToday } from '../../lib/api/deadlines-api';
import type { TodayView } from '../../lib/api/deadlines-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { useLiveQuery, type LiveQueryStatus } from '../../lib/use-live-query';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import { keepItem, NO_KEPT_ITEMS, withKeptItems, type KeptItems } from './today-kept-items';
import { applyItemDone, withoutProject } from './today-optimistic';

export const TODAY_QUERY_KEY = 'today';

export interface TodayData {
  /** The view as shown (kept rows put back); undefined while loading. */
  view: TodayView | undefined;
  status: LiveQueryStatus;
  /** Nothing to show yet and no error. */
  loading: boolean;
  refresh: () => Promise<void>;
  /** The server confirmed that item `id` is now `done` (or open again). */
  onItemDone: (id: string, done: boolean) => void;
  /** After a refused tick: forget the kept rows and reload. */
  refreshAfterConflict: () => Promise<void>;
  /** The server confirmed `status: done` for a project. */
  onProjectDone: (path: VaultPath) => void;
}

export function useTodayData(): TodayData {
  const { data, status, refresh, mutate } = useLiveQuery<TodayView>(TODAY_QUERY_KEY, getToday);
  const [kept, setKept] = useState<KeptItems>(NO_KEPT_ITEMS);
  const view = useMemo(() => (data ? withKeptItems(data, kept) : undefined), [data, kept]);
  const latest = useRef({ view, kept });
  useEffect(() => {
    latest.current = { view, kept };
  });

  // The AI's pages count on "Não hôm nay" (F34): an ingest that just finished changes it.
  useEffect(() => subscribeServerEvent('ai:touched', () => void refresh()), [refresh]);

  const onItemDone = useCallback(
    (id: string, done: boolean) => {
      const { view: shown, kept: before } = latest.current;
      if (shown) {
        const after = keepItem(before, shown, id, done);
        latest.current = { view: shown, kept: after };
        setKept(after);
      }
      // With the rows as they were on screen, so unticking a kept row counts it open again.
      mutate((current) => applyItemDone(withKeptItems(current, before), id, done));
    },
    [mutate],
  );
  // A refused tick reloads the lists: from then on they show what the server has.
  const refreshAfterConflict = useCallback(() => {
    latest.current = { ...latest.current, kept: NO_KEPT_ITEMS };
    setKept(NO_KEPT_ITEMS);
    return refresh();
  }, [refresh]);
  const onProjectDone = useCallback(
    (path: VaultPath) => mutate((current) => withoutProject(current, path)),
    [mutate],
  );

  return {
    view,
    status,
    loading: view === undefined && status !== 'error',
    refresh,
    onItemDone,
    refreshAfterConflict,
    onProjectDone,
  };
}
