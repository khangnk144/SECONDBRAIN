/**
 * Undo after a vault operation (SPEC F20): a 10 s toast whose "Hoàn tác" calls the journal undo.
 * When a touched file changed since, the server refuses and nothing else happens; the user is told
 * how many notes blocked it (F20.2).
 */
import { i18n } from '../i18n';
import { journalConflictCount, journalConflictPaths } from './api-client';
import { postJournalUndo } from './api/journal-api';
import { showOperationError } from './operation-errors';
import { showToast } from './toast-store';
import { useTreeStore } from './tree-store';
import { noteTitleFromPath } from './vault-paths';

/** Shows `message` with a "Hoàn tác" button that runs `undo`. */
export function showUndoToast(message: string, undo: () => Promise<void>): number {
  return showToast({ message, action: { label: i18n.t('operations.undo'), run: undo } });
}

/**
 * The conflict listing of SPEC §4.12 in one sentence: the note that changed by name, or the first
 * one plus how many others; just the count when the server named none.
 */
export function conflictMessage(
  kind: 'undo' | 'complete',
  paths: readonly string[],
  count = paths.length,
): string {
  const prefix = kind === 'undo' ? 'operations.undoConflict' : 'journal.completeConflict';
  const first = paths[0];
  if (first === undefined) return i18n.t(prefix, { count: Math.max(count, 1) });
  const title = noteTitleFromPath(first);
  const others = Math.max(count, paths.length) - 1;
  return others === 0
    ? i18n.t(`${prefix}Named`, { title })
    : i18n.t(`${prefix}NamedMany`, { title, count: others });
}

/** Undo refused: says which note(s) changed since the operation. */
export function showUndoConflict(paths: readonly string[], count = paths.length): void {
  showToast({ message: conflictMessage('undo', paths, count), tone: 'error' });
}

/** Reverts a journaled operation and reports the outcome as a toast. */
export async function undoJournal(journalId: string): Promise<boolean> {
  try {
    await postJournalUndo(journalId);
    useTreeStore.getState().scheduleRefresh();
    showToast({ message: i18n.t('operations.undone') });
    return true;
  } catch (error) {
    const count = journalConflictCount(error);
    if (count !== null) showUndoConflict(journalConflictPaths(error) ?? [], count);
    else showOperationError(error);
    return false;
  }
}

export function showJournalUndoToast(message: string, journalId: string): number {
  return showUndoToast(message, async () => {
    await undoJournal(journalId);
  });
}
