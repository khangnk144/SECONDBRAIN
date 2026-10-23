/**
 * The `activity` part of `GET /api/today` (M5, F35.9 and F24.4), computed on the server from the
 * index and `state/events.jsonl` with the activity service's rules, notes and log reader (the
 * vault's one cached, incremental reader and its shared identity replay; only her own notes
 * count, and the generated "Học kỳ này" page never does):
 * - `days`: notes created or edited on each of the 7 local days ending today ("7 ngày ghi chép");
 * - `doneYesterday`: tasks ticked yesterday in user notes (the encouragement line);
 * - `brain`: "Não hôm nay" – counts and a small constellation (see today-brain.ts).
 */
import { addDays, localMidnight } from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { ActivityNoteRow } from './activity-rows.js';
import {
  computeLinksAdded,
  computeTouchedByDay,
  ownNotePaths,
  type ActivityService,
  type AddedLink,
  type GeneratedEvents,
} from './activity-service.js';
import { aiTouchedPagesOn } from './ai-touched-pages.js';
import type { IndexEvent } from './event-log.js';
import { itemsBetween, trackedLog } from './event-identities.js';
import type { IndexService, TodayActivity } from './index-types.js';
import { buildTodayBrain } from './today-brain.js';

/** "7 ngày ghi chép": today and the six days before it. */
export const ACTIVITY_DAYS = 7;

export interface TodayActivitySources {
  /** Counted notes, done tasks and the log reader of the open vault. */
  activity: ActivityService;
  index: Pick<IndexService, 'outlinks' | 'linkingNotes'>;
  /** `vault.paths.ingestDir` (AI ingest manifests). */
  ingestDir: string;
}

/**
 * Notes created on `day` (`note_created`, reconstructed history included), under their current
 * path; a note deleted since is dropped, and only notes whose touches count are kept.
 */
export function notesCreatedOn(
  events: readonly IndexEvent[],
  notes: readonly ActivityNoteRow[],
  day: string,
  generated: GeneratedEvents = null,
): Set<VaultPath> {
  const counted = ownNotePaths(notes);
  const start = localMidnight(day).toISOString();
  const end = localMidnight(addDays(day, 1)).toISOString();
  const log = trackedLog(events);
  const out = new Set<VaultPath>();
  for (const { event, id } of itemsBetween(log, start, end)) {
    if (event.event !== 'note_created' || generated?.(event.path, event.ts)) continue;
    const path = log.pathOf.get(id);
    if (path !== undefined && counted.has(path)) out.add(path);
  }
  return out;
}

/** What the event log says about the week, for one log state, one day and one set of notes. */
interface LogFacts {
  events: readonly IndexEvent[];
  /** The generator's events left out (a new matcher when the page's spans changed). */
  generated: GeneratedEvents;
  /** `events.length`, today and the notes' paths, classes and mtimes. */
  key: string;
  byDay: Map<string, Set<VaultPath>>;
  links: AddedLink[];
  created: Set<VaultPath>;
}

/**
 * The last log facts per open vault (keyed by that vault's activity service, so they go with
 * the vault): the activity service's own pure functions (`computeTouchedByDay`,
 * `computeLinksAdded`) plus the creations alone ("ghi chú mới") on the events of its shared
 * reader, kept until the log grows, the day changes, a note changes or the generated page's
 * spans change. A miss costs only the week's events: the replay of the log is shared and
 * incremental (`trackedLog`) and the days are found by binary search, so the cost no longer grows
 * with the whole log – Today is fetched after every vault event and has 200 ms (F10.6, review M3).
 */
const lastFacts = new WeakMap<ActivityService, LogFacts>();

function notesKey(notes: readonly ActivityNoteRow[]): string {
  return notes.map((note) => `${note.path}\t${note.class}\t${note.mtimeMs}`).join('\n');
}

async function logFacts(
  sources: TodayActivitySources,
  notes: readonly ActivityNoteRow[],
  today: string,
): Promise<LogFacts> {
  const events = await sources.activity.events();
  const generated = sources.activity.generatedEvents();
  const key = `${events.length}\n${today}\n${notesKey(notes)}`;
  // The reader appends to the same array while the file only grows; a rewrite is a new array.
  const known = lastFacts.get(sources.activity);
  if (known && known.events === events && known.generated === generated && known.key === key)
    return known;
  const from = addDays(today, -(ACTIVITY_DAYS - 1));
  const facts: LogFacts = {
    events,
    generated,
    key,
    byDay: computeTouchedByDay(events, notes, from, today, generated),
    links: computeLinksAdded(events, notes, today, generated),
    created: notesCreatedOn(events, notes, today, generated),
  };
  lastFacts.set(sources.activity, facts);
  return facts;
}

export async function buildTodayActivity(
  sources: TodayActivitySources,
  today: string,
): Promise<TodayActivity> {
  const { activity, index } = sources;
  const notes = activity.notes();
  const [facts, aiPages] = await Promise.all([
    logFacts(sources, notes, today),
    aiTouchedPagesOn(sources.ingestDir, today),
  ]);
  return {
    days: [...facts.byDay].map(([date, paths]) => ({ date, count: paths.size })),
    doneYesterday: activity.doneTasksOn(addDays(today, -1)).length,
    brain: buildTodayBrain({
      notes,
      created: facts.created,
      touched: facts.byDay.get(today) ?? new Set<VaultPath>(),
      links: facts.links,
      aiPages,
      index,
    }),
  };
}
