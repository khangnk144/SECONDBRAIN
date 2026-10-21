/**
 * Strict check of the intent step's JSON: a known kind, real calendar dates with from ≤ to and at
 * most a year apart, a boolean `overdue`, and `about` titles only from the list the model was
 * given (others are dropped). Anything else is invalid and the local rules decide instead.
 */
import {
  diffDays,
  endOfWeekSunday,
  isCalendarDate,
  startOfWeekMonday,
} from '../../lib/local-date.js';
import { linkIdentityKey } from '../../markdown/normalize-text.js';
import { MAX_RANGE_DAYS, type QuestionIntent } from './intent-types.js';

const KINDS = new Set(['deadlines', 'tasks', 'text']);

/** The first JSON object in a reply (models sometimes wrap it in a code fence or a sentence). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function dateOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null;
  return isCalendarDate(value) ? value : undefined;
}

function aboutTitles(value: unknown, topics: readonly string[]): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const byKey = new Map(topics.map((title) => [linkIdentityKey(title), title]));
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const title = byKey.get(linkIdentityKey(entry.trim()));
    if (title !== undefined && !out.includes(title)) out.push(title);
  }
  return out;
}

/** The validated intent, or null when the reply is not a usable intent object. */
export function validateIntent(
  raw: unknown,
  topics: readonly string[],
  today: string,
): QuestionIntent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.kind !== 'string' || !KINDS.has(value.kind)) return null;
  const kind = value.kind as QuestionIntent['kind'];
  const about = aboutTitles(value.about, topics);
  if (about === null) return null;
  if (value.overdue !== undefined && typeof value.overdue !== 'boolean') return null;
  let overdue = value.overdue === true;
  if (kind === 'text')
    return { kind, from: null, to: null, overdue: false, about, source: 'model' };
  if (kind === 'tasks')
    return { kind, from: today, to: today, overdue: true, about, source: 'model' };

  let from = dateOrNull(value.from);
  let to = dateOrNull(value.to);
  if (from === undefined || to === undefined) return null;
  if ((from === null) !== (to === null)) return null;
  if (from !== null && to !== null) {
    const span = diffDays(from, to);
    if (span < 0 || span >= MAX_RANGE_DAYS) return null;
  } else if (!overdue) {
    // A deadline question without a range and not about overdue items means this week.
    from = startOfWeekMonday(today);
    to = endOfWeekSunday(today);
    overdue = true;
  }
  return { kind, from, to, overdue, about, source: 'model' };
}
