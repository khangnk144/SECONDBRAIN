/**
 * What Today, Tasks, Calendar and their popovers do with a deadline item: tick a task, mark a
 * note done, move a date, open the note. Every write carries the revision the view was built
 * from; when the file changed since (409), the user is told which note changed and the list
 * reloads (it would anyway on the WebSocket event), so nothing is guessed (SPEC §4.10, F9.1).
 */
import { formatDisplayDate } from '../../editor/extensions/date-chip-text';
import { parseIsoDate } from '../../editor/local-dates';
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { patchTask, postReschedule } from '../../lib/api/deadlines-api';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import { patchNoteFrontmatter } from '../../lib/api/notes-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { showOperationError } from '../../lib/operation-errors';
import { useTabsStore } from '../../lib/tabs-store';
import { showToast } from '../../lib/toast-store';
import { showUndoToast, undoJournal } from '../../lib/undo-toast';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { openNoteAtLine } from '../backlinks/open-note-at-line';
import { forgetOwnWrites, queueWrite, recordOwnWrite, writeBasis } from './own-write-revisions';

export type DeadlineActionOutcome = 'done' | 'conflict' | 'failed';

export interface DeadlineActionOptions {
  /** Reloads the caller's list after a conflict or a vanished note (e.g. `useLiveQuery().refresh`). */
  refresh?: () => unknown;
}

export interface TickTaskTarget {
  path: VaultPath;
  /** 1-based file line, as the index reports it. */
  line: number;
  /** The line as the view saw it; the server refuses when it reads differently now. */
  lineText: string;
  revision: string;
  /** Task text (without tokens). */
  title: string;
}

export interface NoteDoneTarget {
  path: VaultPath;
  revision: string;
  /** Note title. */
  title: string;
}

/** The file moved on since the view loaded: a stale revision, a changed line, or no task there. */
function isStale(error: unknown): boolean {
  if (isApiError(error, 'CONFLICT')) return true;
  return isApiError(error, 'VALIDATION') && error.details.reason === 'not-a-task';
}

function failed(
  error: unknown,
  path: VaultPath,
  conflictKey: 'tickConflict' | 'changedConflict',
  options: DeadlineActionOptions,
): DeadlineActionOutcome {
  // Whatever happened, the note may not be where our last write left it.
  forgetOwnWrites(path);
  if (isStale(error)) {
    const note = noteTitleFromPath(path);
    showToast({ message: i18n.t(`deadline-items.${conflictKey}`, { note }), tone: 'error' });
    void options.refresh?.();
    return 'conflict';
  }
  showOperationError(error);
  if (isApiError(error, 'NOT_FOUND')) void options.refresh?.();
  return 'failed';
}

/** Ticks (`done`) or unticks one task line through `PATCH /note/task`. */
export function tickTask(
  target: TickTaskTarget,
  done: boolean,
  options: DeadlineActionOptions = {},
): Promise<DeadlineActionOutcome> {
  return queueWrite(target.path, async () => {
    const basis = writeBasis(target.path, target.revision, {
      number: target.line,
      text: target.lineText,
    });
    try {
      const result = await patchTask({
        path: target.path,
        expectedRevision: basis.revision,
        line: target.line,
        expectedText: basis.lineText ?? target.lineText,
        done,
      });
      recordOwnWrite(target.path, {
        sent: basis.revision,
        revision: result.revision,
        linesKept: true,
        line: { number: target.line, text: result.lineText },
      });
      return 'done';
    } catch (error) {
      return failed(error, target.path, 'tickConflict', options);
    }
  });
}

/**
 * Marks a note done (`status: done`) or open again (`status: doing`): note-deadline items and
 * "Đánh dấu dự án xong?". Only that front-matter line changes.
 */
export function setNoteDone(
  target: NoteDoneTarget,
  done: boolean,
  options: DeadlineActionOptions = {},
): Promise<DeadlineActionOutcome> {
  return queueWrite(target.path, async () => {
    const basis = writeBasis(target.path, target.revision);
    try {
      const result = await patchNoteFrontmatter({
        path: target.path,
        expectedRevision: basis.revision,
        set: { status: done ? 'done' : 'doing' },
      });
      // A missing `status:` key (or front matter) is added, which moves the lines below.
      recordOwnWrite(target.path, {
        sent: basis.revision,
        revision: result.revision,
        linesKept: false,
      });
      return 'done';
    } catch (error) {
      return failed(error, target.path, 'changedConflict', options);
    }
  });
}

/** `dd/mm/yyyy` (Vietnamese) or `Nov 5, 2026` (English), like the property bar. */
export function displayDate(iso: string): string {
  const date = parseIsoDate(iso);
  return date ? formatDisplayDate(date) : iso;
}

/**
 * Moves an item to `date` (`YYYY-MM-DD`): only the `📅` date or the `deadline:` value changes.
 * Journaled, so a 10 s "Hoàn tác" toast follows; undo refuses (naming the note) when the file
 * changed again meanwhile (F20.2).
 */
export async function rescheduleItem(
  item: DeadlineItem,
  date: string,
  options: DeadlineActionOptions = {},
): Promise<DeadlineActionOutcome> {
  if (date === item.date) return 'done';
  return queueWrite(item.path, () => reschedule(item, date, options));
}

async function reschedule(
  item: DeadlineItem,
  date: string,
  options: DeadlineActionOptions,
): Promise<DeadlineActionOutcome> {
  const line =
    item.kind === 'task' && item.line !== null && item.lineText !== null
      ? { number: item.line, text: item.lineText }
      : undefined;
  const basis = writeBasis(item.path, item.revision, line);
  const target = line
    ? { kind: 'task' as const, line: line.number, expectedText: basis.lineText ?? line.text }
    : { kind: 'note' as const };
  try {
    const result = await postReschedule({
      path: item.path,
      expectedRevision: basis.revision,
      target,
      date,
    });
    // Without the new line text, a later write on that line sends what its caller saw.
    recordOwnWrite(item.path, {
      sent: basis.revision,
      revision: result.revision,
      linesKept: line !== undefined,
      line: line ? { number: line.number, text: result.lineText ?? null } : undefined,
    });
    // No journal entry means nothing changed on disk: there is nothing to undo.
    if (result.journalId !== null) {
      const message = i18n.t('deadline-items.rescheduled', {
        title: item.title,
        date: displayDate(date),
      });
      const journalId = result.journalId;
      // The undo brings the note back to an older revision: the carry-over ends there.
      showUndoToast(message, () =>
        queueWrite(item.path, async () => {
          await undoJournal(journalId);
          forgetOwnWrites(item.path);
        }),
      );
    }
    return 'done';
  } catch (error) {
    return failed(error, item.path, 'changedConflict', options);
  }
}

/** Opens the item's note: a task at its line, a note deadline at the top. */
export function openItemNote(
  item: { path: VaultPath; line: number | null },
  options: { newTab?: boolean } = {},
): void {
  if (item.line !== null) openNoteAtLine(item.path, item.line, options);
  else useTabsStore.getState().openNote(item.path, { newTab: options.newTab === true });
}
