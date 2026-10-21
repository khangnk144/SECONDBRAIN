/**
 * Local fallback of the intent step (no network): used when the provider fails, returns invalid
 * JSON, or there is nothing in scope to ask about. Keywords decide the kind; range words decide
 * the dates (weeks run Monday–Sunday, SPEC §4.7). Several range words combine into one range.
 */
import {
  addDays,
  daysInMonth,
  endOfWeekSunday,
  parseCalendarDate,
  startOfWeekMonday,
} from '../../lib/local-date.js';
import { foldForMatch } from '../../markdown/normalize-text.js';
import { MAX_RANGE_DAYS, type QuestionIntent } from './intent-types.js';

interface Range {
  from: string;
  to: string;
}

/** ` word word ` forms (single spaces, padded) so phrases match on whole words only. */
function wordLine(text: string): string {
  return ` ${(text.match(/[\p{L}\p{N}]+/gu) ?? []).join(' ')} `;
}

const has = (line: string, phrases: readonly string[]) =>
  phrases.some((phrase) => line.includes(` ${phrase} `));

const OVERDUE = ['qua han', 'tre han', 'overdue', 'past due'];
const DEADLINE = [
  'den han',
  'han chot',
  'han nop',
  'deadline',
  'deadlines',
  'nop',
  'due',
  'submit',
];

/**
 * "hạn" alone (`Tuần này có hạn gì?`) without matching "hàn" (Hàn Quốc) or "hạn chế": judged on
 * the accented text, or on the folded text only when the question was typed without diacritics.
 */
function mentionsHan(question: string): boolean {
  const accented = wordLine(question.normalize('NFC').toLowerCase())
    .replace(/ (?:quá|trễ) hạn /gu, ' ')
    .replace(/ hạn chế /gu, ' ');
  if (accented.includes(' hạn ')) return true;
  // eslint-disable-next-line no-control-regex -- "only ASCII" is exactly the test
  if (/[^\u0000-\u007f]/.test(question)) return false;
  const folded = wordLine(foldForMatch(question))
    .replace(/ (?:qua|tre) han /g, ' ')
    .replace(/ han (?:che|quoc) /g, ' ');
  return folded.includes(' han ');
}
const TASK = ['viec', 'task', 'tasks', 'todo', 'to do', 'nhiem vu', 'can lam'];
const WHATS_ON = ['co gi', 'what do i have', 'what s on', 'what is on', 'whats on'];

function monthRange(today: string, offset: number): Range {
  const parts = parseCalendarDate(today)!;
  const index = parts.year * 12 + (parts.month - 1) + offset;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${daysInMonth(year, month)}` };
}

/** Every range named in the question (folded word line), in no particular order. */
function namedRanges(line: string, today: string): Range[] {
  const ranges: Range[] = [];
  const monday = startOfWeekMonday(today);
  const sunday = endOfWeekSunday(today);
  if (has(line, ['hom nay', 'today', 'tonight'])) ranges.push({ from: today, to: today });
  if (has(line, ['ngay mai', 'tomorrow'])) {
    ranges.push({ from: addDays(today, 1), to: addDays(today, 1) });
  }
  if (has(line, ['tuan nay', 'this week'])) ranges.push({ from: monday, to: sunday });
  if (has(line, ['tuan sau', 'tuan toi', 'next week'])) {
    ranges.push({ from: addDays(monday, 7), to: addDays(sunday, 7) });
  }
  if (has(line, ['thang nay', 'this month'])) ranges.push(monthRange(today, 0));
  if (has(line, ['thang sau', 'thang toi', 'next month'])) ranges.push(monthRange(today, 1));
  // "7 ngày tới", "trong 10 ngày", "next 5 days", "within 3 days": today … today + N.
  const days =
    /(?:^| )(\d{1,3}) ngay (?:toi|nua|sap toi)(?= )/.exec(line) ??
    /(?:^| )trong (\d{1,3}) ngay(?= )/.exec(line) ??
    /(?:^| )(?:next|within) (\d{1,3}) days?(?= )/.exec(line);
  if (days) {
    const n = Math.min(Number(days[1]), MAX_RANGE_DAYS - 1);
    if (n > 0) ranges.push({ from: today, to: addDays(today, n) });
  }
  return ranges;
}

function union(ranges: Range[]): Range | null {
  if (ranges.length === 0) return null;
  const from = ranges.map((r) => r.from).sort()[0]!;
  const to = ranges
    .map((r) => r.to)
    .sort()
    .at(-1)!;
  return { from, to };
}

/** Topics whose title appears in the question as whole words (diacritics ignored). */
export function topicsNamedIn(question: string, topics: readonly string[]): string[] {
  const line = wordLine(foldForMatch(question));
  return topics.filter((title) => {
    const words = wordLine(foldForMatch(title)).trim();
    return words !== '' && line.includes(` ${words} `);
  });
}

export function ruleIntent(
  question: string,
  today: string,
  topics: readonly string[] = [],
): QuestionIntent {
  const line = wordLine(foldForMatch(question));
  const overdueAsked = has(line, OVERDUE);
  // "quá hạn" contains "hạn": only other deadline words make it more than an overdue question.
  const deadlineWord =
    has(line.replace(/ (?:qua|tre) han /g, ' '), DEADLINE) || mentionsHan(question);
  const range = union(namedRanges(line, today));
  const isToday = range !== null && range.from === today && range.to === today;
  let kind: QuestionIntent['kind'] = 'text';
  if (deadlineWord || overdueAsked) kind = 'deadlines';
  else if (has(line, TASK)) kind = range && !isToday ? 'deadlines' : 'tasks';
  else if (range && has(line, WHATS_ON)) kind = 'deadlines';

  const about = kind === 'text' ? [] : topicsNamedIn(question, topics);
  if (kind === 'text') {
    return { kind, from: null, to: null, overdue: false, about, source: 'rules' };
  }
  if (kind === 'tasks')
    return { kind, from: today, to: today, overdue: true, about, source: 'rules' };
  // A deadline question without a range means this week; "what is overdue?" alone means only that.
  const week = { from: startOfWeekMonday(today), to: endOfWeekSunday(today) };
  const effective = range ?? (overdueAsked && !deadlineWord ? null : week);
  const thisWeekOrToday =
    effective !== null &&
    ((effective.from === week.from && effective.to === week.to) ||
      (effective.from === today && effective.to === today));
  return {
    kind,
    from: effective?.from ?? null,
    to: effective?.to ?? null,
    overdue: overdueAsked || thisWeekOrToday,
    about,
    source: 'rules',
  };
}
