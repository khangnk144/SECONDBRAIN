/**
 * The server renders the list of a structured answer itself (SPEC F33.1): every item, no
 * truncation, grouped by day with localized dates and relative text, each item linked once.
 * The model only writes an introduction from the counts; it never sees or repeats the items.
 */
import type { AnswerLanguage } from '../prompts/answer-language.js';
import { noteLink } from '../citations/link-format.js';
import { isCalendarDate } from '../../lib/local-date.js';
import { substituteWikilinks } from '../../markdown/wikilink-scan.js';
import { dayGroupLabel, dayLabel, inSentence, relativeDays, shortDate } from './answer-dates.js';
import type { AnswerEntry, AnswerGroup, StructuredAnswer } from './structured-items.js';

const OVERDUE_LABEL: Record<AnswerLanguage, string> = { vi: 'Quá hạn', en: 'Overdue' };
const DAILY_NOTE = /^daily\/(\d{4}-\d{2}-\d{2})\.md$/i;

export function groupLabel(group: AnswerGroup, today: string, language: AnswerLanguage): string {
  if (group.kind === 'overdue' || group.date === null) return OVERDUE_LABEL[language];
  const daysLeft = group.entries[0]?.daysLeft ?? 0;
  return dayGroupLabel(group.date, group.date === today ? 0 : daysLeft, today, language);
}

/** The date of a Daily note (`Daily/2026-10-20.md`), else null. */
function dailyDate(entry: AnswerEntry): string | null {
  const date = DAILY_NOTE.exec(entry.path)?.[1] ?? null;
  return date !== null && isCalendarDate(date) ? date : null;
}

/** "trong [[…|Đồ án]]"; a Daily note is named by its day: "trong daily note 20/10". */
function placeOf(
  entry: AnswerEntry,
  daily: string | null,
  today: string,
  language: AnswerLanguage,
) {
  if (daily === null) {
    return `${language === 'vi' ? 'trong' : 'in'} ${noteLink(entry.path, entry.noteTitle)}`;
  }
  const day = shortDate(daily, today, language);
  return language === 'vi'
    ? `trong ${noteLink(entry.path, `daily note ${day}`)}`
    : `in the ${noteLink(entry.path, `daily note of ${day}`)}`;
}

function entryLine(entry: AnswerEntry, overdue: boolean, today: string, language: AnswerLanguage) {
  const daily = entry.kind === 'task' ? dailyDate(entry) : null;
  // Overdue items come from different days: each one says its date (unless the Daily note it is
  // in already names that day) and how late it is.
  const late =
    overdue && entry.date !== null && entry.daysLeft !== null
      ? relativeDays(entry.daysLeft, language)
      : null;
  const when =
    late === null || entry.date === daily
      ? late
      : `${shortDate(entry.date!, today, language)}, ${late}`;
  if (entry.kind === 'note') {
    return `- ${noteLink(entry.path, entry.noteTitle)}${when ? ` (${when})` : ''}`;
  }
  // The item's own note is its one link: links inside the task text are shown as their words.
  const title = substituteWikilinks(entry.title);
  return `- ${title} (${placeOf(entry, daily, today, language)}${when ? `, ${when}` : ''})`;
}

export function renderStructuredList(
  answer: StructuredAnswer,
  today: string,
  language: AnswerLanguage,
): string {
  return answer.groups
    .map((group) => {
      const overdue = group.kind === 'overdue';
      const lines = group.entries.map((entry) => entryLine(entry, overdue, today, language));
      return [`**${groupLabel(group, today, language)}**`, ...lines].join('\n');
    })
    .join('\n\n');
}

function rangeText(answer: StructuredAnswer, today: string, language: AnswerLanguage): string {
  if (!answer.range) return '';
  const { from, to } = answer.range;
  if (from === to) {
    const day = inSentence(dayLabel(from, today, language), language);
    return language === 'vi' ? ` vào ${day}` : ` on ${day}`;
  }
  const a = shortDate(from, today, language);
  const b = shortDate(to, today, language);
  return language === 'vi' ? ` từ ${a} đến ${b}` : ` from ${a} to ${b}`;
}

/**
 * Said before the full list when no item of the range belongs to the asked topic (`aboutUnmatched`):
 * honest about the filter instead of a confident "none".
 */
export function unmatchedTopicSentence(answer: StructuredAnswer, language: AnswerLanguage): string {
  const about = answer.about.join(', ');
  const n = answer.total;
  if (language === 'vi') {
    const where =
      answer.kind === 'tasks' ? 'hôm nay' : answer.range ? 'trong khoảng này' : 'đang quá hạn';
    return `Không thấy việc nào gắn với ${about}. Đây là ${n} việc ${where}:`;
  }
  const items = n === 1 ? 'is the 1 item' : `are the ${n} items`;
  if (answer.kind === 'tasks') return `Nothing found linked to ${about}. Here ${items} for today:`;
  if (!answer.range) {
    const overdue = n === 1 ? 'is the 1 overdue item' : `are the ${n} overdue items`;
    return `Nothing found linked to ${about}. Here ${overdue}:`;
  }
  return `Nothing found linked to ${about}. Here ${items} in this range:`;
}

/** The fixed sentence for an answer without items (no model call, SPEC F33.1). */
export function noItemsSentence(
  answer: StructuredAnswer,
  today: string,
  language: AnswerLanguage,
): string {
  const about = answer.about.length > 0 ? answer.about.join(', ') : null;
  if (language === 'vi') {
    const topic = about ? ` cho ${about}` : '';
    if (answer.kind === 'tasks') return `Hôm nay không còn việc nào cần làm${topic}.`;
    if (!answer.range) return `Không có việc nào quá hạn${topic}.`;
    return `Không có deadline nào còn mở${topic}${rangeText(answer, today, language)}.`;
  }
  const topic = about ? ` for ${about}` : '';
  if (answer.kind === 'tasks') return `Nothing left to do today${topic}.`;
  if (!answer.range) return `Nothing is overdue${topic}.`;
  return `No open deadlines${topic}${rangeText(answer, today, language)}.`;
}

/** Said when items were left out because their folders are outside the AI scope. */
export function hiddenSentence(hidden: number, language: AnswerLanguage): string {
  if (language === 'vi') {
    return `*Có ${hidden} mục trong thư mục ngoài phạm vi AI nên không được liệt kê.*`;
  }
  return hidden === 1
    ? '*1 item in a folder outside the AI scope is not listed.*'
    : `*${hidden} items in folders outside the AI scope are not listed.*`;
}

/** What the introduction call receives: counts and group labels, never the items. */
export function introFacts(
  answer: StructuredAnswer,
  today: string,
  language: AnswerLanguage,
): string {
  const vi = language === 'vi';
  const lines = [
    `${vi ? 'Loại' : 'Kind'}: ${answer.kind === 'tasks' ? (vi ? 'việc hôm nay' : "today's tasks") : 'deadline'}`,
  ];
  const range = rangeText(answer, today, language).trim();
  if (range) lines.push(`${vi ? 'Khoảng' : 'Range'}: ${range}`);
  if (answer.about.length > 0) lines.push(`${vi ? 'Chủ đề' : 'Topic'}: ${answer.about.join(', ')}`);
  lines.push(`${vi ? 'Tổng số mục còn mở' : 'Open items'}: ${answer.total}`);
  for (const group of answer.groups) {
    lines.push(`- ${groupLabel(group, today, language)}: ${group.entries.length}`);
  }
  return lines.join('\n');
}
