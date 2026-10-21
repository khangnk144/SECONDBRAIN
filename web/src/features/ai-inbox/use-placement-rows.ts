/**
 * One proposal per Inbox note, asked for only when she presses "Gợi ý" on that row: one request
 * at a time (sequential, never automatic for all), abortable, and applied only with "Áp dụng" –
 * with just the parts she left checked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { runAiAction } from '../../lib/api/ai-api';
import type { AiPlacementSuggestion } from '../../lib/api/ai-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteTitleFromPath, parentFolder, samePath } from '../../lib/vault-paths';
import { isAbortError } from '../ai-actions/ai-error-message';
import { applyPlacement } from './placement-apply';

export type RowState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'keep'; reason: string }
  | {
      kind: 'proposal';
      proposal: AiPlacementSuggestion;
      /** Offered parts (what differs from now) and whether each is still checked. */
      offersMove: boolean;
      offersRename: boolean;
      move: boolean;
      rename: boolean;
      applying: boolean;
    }
  | { kind: 'applied'; path: VaultPath }
  | { kind: 'skipped' };

function proposalRow(path: VaultPath, proposal: AiPlacementSuggestion): RowState {
  const offersMove = !proposal.keep && !samePath(proposal.folder, parentFolder(path));
  const offersRename = !proposal.keep && proposal.title !== noteTitleFromPath(path);
  if (!offersMove && !offersRename) return { kind: 'keep', reason: proposal.reason };
  return {
    kind: 'proposal',
    proposal,
    offersMove,
    offersRename,
    move: offersMove,
    rename: offersRename,
    applying: false,
  };
}

export function usePlacementRows() {
  const [rows, setRows] = useState<Record<VaultPath, RowState>>({});
  const [busyPath, setBusyPath] = useState<VaultPath | null>(null);
  const busy = useRef<{ path: VaultPath; abort: AbortController } | null>(null);
  const set = useCallback(
    (path: VaultPath, row: RowState) => setRows((current) => ({ ...current, [path]: row })),
    [],
  );

  const suggest = useCallback(
    (path: VaultPath) => {
      if (busy.current) return;
      const abort = new AbortController();
      busy.current = { path, abort };
      setBusyPath(path);
      set(path, { kind: 'loading' });
      const finish = (row: RowState | null) => {
        if (busy.current?.abort !== abort) return;
        busy.current = null;
        setBusyPath(null);
        if (row) set(path, row);
      };
      runAiAction({ action: 'suggest-placement', path }, { signal: abort.signal }).then(
        (proposal) => finish(proposalRow(path, proposal)),
        (error: unknown) => finish(isAbortError(error) ? null : { kind: 'error', error }),
      );
    },
    [set],
  );

  const cancel = useCallback(() => {
    const current = busy.current;
    if (!current) return;
    current.abort.abort();
    busy.current = null;
    setBusyPath(null);
    set(current.path, { kind: 'idle' });
  }, [set]);

  const update = useCallback((path: VaultPath, change: (row: RowState) => RowState) => {
    setRows((current) => {
      const row = current[path];
      return row ? { ...current, [path]: change(row) } : current;
    });
  }, []);

  const toggle = useCallback(
    (path: VaultPath, part: 'move' | 'rename') =>
      update(path, (row) => (row.kind === 'proposal' ? { ...row, [part]: !row[part] } : row)),
    [update],
  );

  /** Runs the checked parts; resolves with the note's new path, or null when nothing changed. */
  const apply = useCallback(
    async (path: VaultPath): Promise<VaultPath | null> => {
      const row = rows[path];
      if (row?.kind !== 'proposal' || row.applying || (!row.move && !row.rename)) return null;
      set(path, { ...row, applying: true });
      const result = await applyPlacement(path, {
        folder: row.move ? row.proposal.folder : null,
        title: row.rename ? row.proposal.title : null,
      });
      if (result.ok) {
        set(path, { kind: 'applied', path: result.path });
        return result.path;
      }
      set(path, { ...row, applying: false });
      return null;
    },
    [rows, set],
  );

  const skip = useCallback((path: VaultPath) => set(path, { kind: 'skipped' }), [set]);

  useEffect(() => () => busy.current?.abort.abort(), []);

  return { rows, busyPath, suggest, cancel, toggle, apply, skip };
}
