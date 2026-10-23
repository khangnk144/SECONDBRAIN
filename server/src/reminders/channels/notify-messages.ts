/**
 * Telegram/email texts in the UI language (SPEC F31.4), owned by the server like the toast
 * texts (no app window needs to be open). The relative part is computed when the message is
 * sent, so a retry two hours later still says the right thing.
 *   vi: "⏰ Đồ án Giải tích – hạn 24/10/2026 (còn 3 ngày)" + note path + app link
 *   en: "⏰ Đồ án Giải tích – due 24 October 2026 (3 days left)"
 */
import { diffDays } from '../../lib/local-date.js';
import {
  formatDueDate,
  noteDeepLink,
  toastTitleText,
  type ReminderLanguage,
} from '../reminder-messages.js';
import type { ChannelMessage } from './channel-types.js';

const TEXT = {
  vi: {
    due: 'hạn',
    left: (n: number) => `còn ${n} ngày`,
    today: 'hôm nay',
    overdue: 'đã quá hạn',
    note: 'Ghi chú',
    open: 'Mở trong Second Brain',
    testSubject: 'Second Brain: tin nhắn thử',
    testText: 'Đây là tin nhắn thử từ Second Brain. Nhắc nhở deadline sẽ đến đây.',
  },
  en: {
    due: 'due',
    left: (n: number) => (n === 1 ? '1 day left' : `${n} days left`),
    today: 'today',
    overdue: 'overdue',
    note: 'Note',
    open: 'Open in Second Brain',
    testSubject: 'Second Brain: test message',
    testText: 'This is a test message from Second Brain. Deadline reminders will arrive here.',
  },
} as const;

export interface ReminderMessageInput {
  title: string;
  path: string;
  /** `YYYY-MM-DD`. */
  due: string;
  /** Local date the message is sent on. */
  today: string;
  port: number;
}

/** "còn 3 ngày" / "hôm nay" / "đã quá hạn" from the dates. */
export function relativeDue(due: string, today: string, language: ReminderLanguage): string {
  const text = TEXT[language];
  const days = diffDays(today, due);
  if (days > 0) return text.left(days);
  return days === 0 ? text.today : text.overdue;
}

/** Control characters (a line break in a path on Linux) never reach a mail header or line. */
// eslint-disable-next-line no-control-regex
const oneLine = (value: string) => value.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ');

export function reminderMessage(
  input: ReminderMessageInput,
  language: ReminderLanguage,
): ChannelMessage {
  const text = TEXT[language];
  const headline =
    `⏰ ${toastTitleText(input.title)} – ${text.due} ${formatDueDate(input.due, language)}` +
    ` (${relativeDue(input.due, input.today, language)})`;
  return {
    subject: headline,
    text: [
      headline,
      `${text.note}: ${oneLine(input.path)}`,
      `${text.open}: ${noteDeepLink(input.port, input.path)}`,
    ].join('\n'),
  };
}

export function testMessage(language: ReminderLanguage): ChannelMessage {
  const text = TEXT[language];
  return { subject: text.testSubject, text: text.testText };
}
