/**
 * What she did on which day (M5: Today's "7 ngày ghi chép" and encouragement line, "Não hôm nay",
 * the weekly review), computed on the server from `state/events.jsonl` and the index:
 * - touched notes = created or edited (`note_created`, `note_edited`), reported under their
 *   current path, deleted notes dropped, only her own notes (user, archived; wiki pages are the
 *   AI's and count only in "AI cập nhật n trang", review L3);
 * - days before the log knew `note_edited` (before its first line) also count the day of each
 *   note's file mtime, the best the app can know about edits it never logged;
 * - done tasks = `✅` dates of tasks in user notes (the index);
 * - added links = unique linking-note → target pairs of `link_added` lines.
 * What the app writes itself never counts: the generated "Học kỳ này" page (F25) while it is on
 * (`exclude`), and every event the generator wrote at its path, also after the page was turned
 * off (`generatedEvents`, review L2). Dates are local calendar dates (`YYYY-MM-DD`, see
 * lib/local-date.ts). The service also holds the vault's one cached reader of the log
 * (`events()`), shared by Today and the graph history; the identity replay of the log is shared
 * and incremental (`trackedLog`), and each day is found by binary search (review M3).
 */
import {
  addDays,
  dateRange,
  diffDays,
  isCalendarDate,
  localMidnight,
  toLocalDate,
} from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import { isOwnWriting, type ActivityNoteRow, type DoneTaskRow } from './activity-rows.js';
import type { IndexEvent } from './event-log.js';
import { createEventLogReader, type EventLogReader } from './event-log-reader.js';
import { itemsBetween, trackedLog, type TrackedLog } from './event-identities.js';
import type { IndexService } from './index-types.js';

/** `(path, ts) => true` for an event the app wrote itself (the generated page); null: none. */
export type GeneratedEvents = ((path: VaultPath, ts: string) => boolean) | null;

/** Longest range one call may ask for (a year and a bit). */
export const MAX_ACTIVITY_DAYS = 400;

export interface AddedLink {
  /** Current path of the linking note. */
  from: VaultPath;
  /** Current path of the target note, or the logged target (ghost text, file path). */
  to: string;
  /** The target is a note that exists now (counts as a link between two notes). */
  resolved: boolean;
}

export interface ActivityService {
  /** Local date of "now" by the vault's clock. */
  today(): string;
  /**
   * Notes the views know (user, archived, wiki; never a page the app generates while it is on);
   * only user and archived ones count as her writing (`isOwnWriting`).
   */
  notes(): ActivityNoteRow[];
  /** The events the app wrote itself (left out of every count), as of now. */
  generatedEvents(): GeneratedEvents;
  /**
   * Every readable event of `events.jsonl` in file order, through the vault's one cached,
   * incremental reader: the same array while the file only grows, a new one after a rewrite.
   */
  events(): Promise<readonly IndexEvent[]>;
  /** One entry per day of `[from, to]` (empty sets included), each the notes touched that day. */
  touchedNotesByDay(from: string, to: string): Promise<Map<string, Set<VaultPath>>>;
  /** Done tasks of user notes with `✅ date`, newest first. */
  doneTasksOn(date: string): DoneTaskRow[];
  doneTasksBetween(from: string, to: string): DoneTaskRow[];
  /** Links added on `date` (unique pairs), linking notes under their current path. */
  linksAddedOn(date: string): Promise<AddedLink[]>;
}

export type ActivityIndex = Pick<IndexService, 'activityNotes' | 'doneTasksBetween'>;

function checkRange(from: string, to: string): void {
  if (!isCalendarDate(from) || !isCalendarDate(to)) throw new RangeError('Not a calendar date');
  const days = diffDays(from, to);
  if (days < 0 || days >= MAX_ACTIVITY_DAYS) throw new RangeError('Unsupported date range');
}

/** `[start, end)` of local days `from`…`to` as ISO instants (comparable with event `ts`). */
function instantBounds(from: string, to: string): [string, string] {
  return [localMidnight(from).toISOString(), localMidnight(addDays(to, 1)).toISOString()];
}

/** Local day of the first non-approximate `note_edited`, or null when there is none. */
function firstEditDay(log: TrackedLog): string | null {
  const first = log.firstExactEdit;
  return first ? toLocalDate(new Date(first.event.ts)) : null;
}

/** Paths of the notes whose touches count as her writing. */
export const ownNotePaths = (notes: readonly ActivityNoteRow[]): Set<VaultPath> =>
  new Set(notes.filter(isOwnWriting).map((note) => note.path));

export function computeTouchedByDay(
  events: readonly IndexEvent[],
  notes: readonly ActivityNoteRow[],
  from: string,
  to: string,
  generated: GeneratedEvents = null,
): Map<string, Set<VaultPath>> {
  checkRange(from, to);
  const out = new Map<string, Set<VaultPath>>(dateRange(from, to).map((d) => [d, new Set()]));
  const counted = ownNotePaths(notes);
  const log = trackedLog(events);
  const [start, end] = instantBounds(from, to);
  for (const { event, id } of itemsBetween(log, start, end)) {
    if (event.event !== 'note_created' && event.event !== 'note_edited') continue;
    if (generated?.(event.path, event.ts)) continue;
    const path = log.pathOf.get(id);
    if (path !== undefined && counted.has(path))
      out.get(toLocalDate(new Date(event.ts)))?.add(path);
  }
  const cutoff = firstEditDay(log);
  for (const note of notes) {
    if (!counted.has(note.path)) continue;
    const day = toLocalDate(new Date(note.mtimeMs));
    if (cutoff !== null && day > cutoff) continue;
    if (!out.has(day) || generated?.(note.path, new Date(note.mtimeMs).toISOString())) continue;
    out.get(day)?.add(note.path);
  }
  return out;
}

export function computeLinksAdded(
  events: readonly IndexEvent[],
  notes: readonly ActivityNoteRow[],
  date: string,
  generated: GeneratedEvents = null,
): AddedLink[] {
  checkRange(date, date);
  const counted = ownNotePaths(notes);
  const known = new Set(notes.map((note) => note.path));
  const log = trackedLog(events);
  const [start, end] = instantBounds(date, date);
  const seen = new Map<string, AddedLink>();
  for (const { event, id, targetId } of itemsBetween(log, start, end)) {
    if (event.event !== 'link_added' || event.target === undefined) continue;
    if (generated?.(event.path, event.ts)) continue;
    const from = log.pathOf.get(id);
    if (from === undefined || !counted.has(from)) continue;
    const to = (targetId !== null ? log.pathOf.get(targetId) : undefined) ?? event.target;
    const key = `${from}\n${to}`;
    if (!seen.has(key)) seen.set(key, { from, to, resolved: known.has(to) });
  }
  return [...seen.values()];
}

export interface ActivityServiceOptions {
  /** `vault.paths.eventsFile`. */
  eventsFile: string;
  index: ActivityIndex;
  now: () => Date;
  /** A shared reader of the same file (tests); default: one of its own. */
  reader?: EventLogReader;
  /** Notes never counted although they are user notes: the generated "Học kỳ này" page. */
  exclude?: (path: VaultPath) => boolean;
  /** Events the app wrote itself at the page's paths, also after it was turned off (L2). */
  generatedEvents?: () => GeneratedEvents;
}

export function createActivityService(options: ActivityServiceOptions): ActivityService {
  const reader = options.reader ?? createEventLogReader(options.eventsFile);
  const { index } = options;
  const exclude = options.exclude;
  const notes = () =>
    exclude ? index.activityNotes().filter((n) => !exclude(n.path)) : index.activityNotes();
  const tasks = (from: string, to: string) => {
    const rows = index.doneTasksBetween(from, to);
    return exclude ? rows.filter((row) => !exclude(row.path)) : rows;
  };
  return {
    today: () => toLocalDate(options.now()),
    notes,
    generatedEvents: () => options.generatedEvents?.() ?? null,
    events: () => reader.read(),
    async touchedNotesByDay(from, to) {
      checkRange(from, to);
      const generated = options.generatedEvents?.() ?? null;
      return computeTouchedByDay(await reader.read(), notes(), from, to, generated);
    },
    doneTasksOn(date) {
      checkRange(date, date);
      return tasks(date, date);
    },
    doneTasksBetween(from, to) {
      checkRange(from, to);
      return tasks(from, to);
    },
    async linksAddedOn(date) {
      checkRange(date, date);
      const generated = options.generatedEvents?.() ?? null;
      return computeLinksAdded(await reader.read(), notes(), date, generated);
    },
  };
}
