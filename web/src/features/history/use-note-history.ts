/**
 * A note's version history for the dialog and the right pane: the commits (newest first) and,
 * for the dialog, the note as it is now (text for the diff, revision for the restore check).
 * Without git the answer is `unavailable` and nothing else happens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { isApiError } from '../../lib/api-client';
import { getHistoryStatus, getNoteHistory } from '../../lib/api/history-api';
import type { HistoryCommit, HistoryUnavailableReason } from '../../lib/api/history-types';
import { getNote } from '../../lib/api/notes-api';
import type { VaultPath } from '../../lib/api/vault-types';

export interface CurrentNote {
  content: string;
  revision: string;
}

export type NoteHistoryState =
  | { status: 'loading' }
  | { status: 'unavailable'; reason: HistoryUnavailableReason | null }
  | { status: 'missing' }
  | { status: 'error'; offline: boolean }
  | { status: 'ready'; commits: HistoryCommit[]; current: CurrentNote | null };

/** Why history is off, for the message (null when even the status could not be read). */
async function unavailableReason(): Promise<HistoryUnavailableReason | null> {
  try {
    return (await getHistoryStatus()).reason ?? null;
  } catch {
    return null;
  }
}

export function useNoteHistory(
  path: VaultPath | null,
  options: { withCurrent: boolean; enabled?: boolean; refreshKey?: number },
) {
  const { withCurrent, enabled = true, refreshKey = 0 } = options;
  const [state, setState] = useState<NoteHistoryState>({ status: 'loading' });
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    let next: NoteHistoryState;
    try {
      const [history, note] = await Promise.all([
        getNoteHistory(path),
        withCurrent ? getNote(path) : Promise.resolve(null),
      ]);
      if (!history.available) {
        next = { status: 'unavailable', reason: await unavailableReason() };
      } else {
        const current = note ? { content: note.content, revision: note.revision } : null;
        next = { status: 'ready', commits: history.commits, current };
      }
    } catch (error) {
      if (isApiError(error, 'UNAVAILABLE')) {
        const reason = error.details.reason;
        next = { status: 'unavailable', reason: (reason as HistoryUnavailableReason) ?? null };
      } else if (isApiError(error, 'NOT_FOUND')) next = { status: 'missing' };
      else next = { status: 'error', offline: error instanceof TypeError };
    }
    if (mine === seq.current) setState(next);
  }, [path, withCurrent]);

  useEffect(() => {
    if (!enabled) return;
    setState({ status: 'loading' });
    void load();
  }, [load, enabled, refreshKey]);

  useEffect(
    () => () => {
      seq.current += 1;
    },
    [],
  );

  return { state, reload: load };
}
