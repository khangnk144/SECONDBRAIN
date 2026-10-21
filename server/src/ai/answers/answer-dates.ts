/**
 * Dates as the answers write them, in the answer's language (design.md §7: sentence case), the
 * year only when it is not this year: Vietnamese "Thứ sáu 23/10", English in the app's long
 * format "Friday, October 23" (Today's `dddd, MMMM D`); relative text "còn 2 ngày" / "in 2 days".
 */
import { isoWeekday } from '../../lib/local-date.js';
import type { AnswerLanguage } from '../prompts/answer-language.js';

const WEEKDAYS: Record<AnswerLanguage, readonly string[]> = {
  vi: ['Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy', 'Chủ nhật'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

const MONTHS_EN = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** `23/10` (`23/10/2027` outside the current year); English `October 23` (`October 23, 2027`). */
export function shortDate(date: string, today: string, language: AnswerLanguage): string {
  const [year, month, day] = date.split('-');
  const sameYear = year === today.slice(0, 4);
  if (language === 'en') {
    const base = `${MONTHS_EN[Number(month) - 1] ?? month} ${Number(day)}`;
    return sameYear ? base : `${base}, ${year}`;
  }
  const base = `${day}/${month}`;
  return sameYear ? base : `${base}/${year}`;
}

/** `Thứ sáu 23/10` / `Friday, October 23`. */
export function dayLabel(date: string, today: string, language: AnswerLanguage): string {
  const weekday = WEEKDAYS[language][isoWeekday(date) - 1];
  const separator = language === 'en' ? ', ' : ' ';
  return `${weekday}${separator}${shortDate(date, today, language)}`;
}

/** Lower-case first letter for use inside a sentence (Vietnamese weekdays only). */
export function inSentence(label: string, language: AnswerLanguage): string {
  return language === 'vi' ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}

/** `hôm nay`, `ngày mai`, `còn 4 ngày`, `quá hạn 3 ngày` (and the English forms). */
export function relativeDays(daysLeft: number, language: AnswerLanguage): string {
  if (language === 'vi') {
    if (daysLeft === 0) return 'hôm nay';
    if (daysLeft === 1) return 'ngày mai';
    return daysLeft > 0 ? `còn ${daysLeft} ngày` : `quá hạn ${-daysLeft} ngày`;
  }
  if (daysLeft === 0) return 'today';
  if (daysLeft === 1) return 'tomorrow';
  if (daysLeft > 1) return `in ${daysLeft} days`;
  return daysLeft === -1 ? '1 day overdue' : `${-daysLeft} days overdue`;
}

/**
 * Heading of one day's group: "Hôm nay, thứ hai 19/10", "Thứ sáu 23/10 (còn 4 ngày)",
 * "Today, Monday, October 19".
 */
export function dayGroupLabel(
  date: string,
  daysLeft: number,
  today: string,
  language: AnswerLanguage,
): string {
  const label = dayLabel(date, today, language);
  if (daysLeft === 0)
    return `${language === 'vi' ? 'Hôm nay' : 'Today'}, ${inSentence(label, language)}`;
  if (daysLeft === 1) {
    return `${language === 'vi' ? 'Ngày mai' : 'Tomorrow'}, ${inSentence(label, language)}`;
  }
  return `${label} (${relativeDays(daysLeft, language)})`;
}
