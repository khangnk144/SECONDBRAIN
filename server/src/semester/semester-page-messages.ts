/**
 * Text of the generated "Học kỳ này" page (SPEC F25.1) in the UI language at generation time. The
 * server writes the page, so these strings live here, not in the web translations (like the
 * reminder toasts). Copy follows design.md §7: friendly, sentence case, commas, no middle dots.
 */
import { formatDueDate, type ReminderLanguage } from '../reminders/reminder-messages.js';

export type PageLanguage = ReminderLanguage;

export interface PageText {
  /** File name at the vault root, chosen once when the page is turned on. */
  fileName: string;
  intro: string;
  courses: string;
  noCourses: string;
  lectures: (count: number) => string;
  projects: string;
  noProjects: string;
  /** Group of projects whose `course:` names no listed course. */
  other: string;
  due: (date: string) => string;
  noDeadline: string;
  daysLeft: (days: number) => string;
  progress: (done: number, total: number) => string;
  noTasks: string;
}

const VI: PageText = {
  fileName: 'Học kỳ này.md',
  intro:
    'Trang này do Second Brain tạo tự động từ các ghi chú môn học và đồ án. ' +
    'Muốn đổi thì sửa các ghi chú đó.',
  courses: 'Môn học',
  noCourses: 'Chưa có môn học nào. Thêm `type: course` vào ghi chú của một môn để nó hiện ở đây.',
  lectures: (count) => (count === 0 ? 'chưa có bài giảng' : `${count} bài giảng`),
  projects: 'Đồ án',
  noProjects: 'Chưa có đồ án nào đang làm.',
  other: 'Khác',
  due: (date) => `hạn ${formatDueDate(date, 'vi')}`,
  noDeadline: 'chưa có hạn',
  daysLeft: (days) =>
    days > 0 ? `còn ${days} ngày` : days === 0 ? 'đến hạn hôm nay' : `quá hạn ${-days} ngày`,
  progress: (done, total) => `xong ${done}/${total} việc`,
  noTasks: 'chưa có việc',
};

const plural = (count: number, one: string, other: string) =>
  `${count} ${count === 1 ? one : other}`;

const EN: PageText = {
  fileName: 'This semester.md',
  intro:
    'Second Brain makes this page from your course and project notes. ' +
    'To change it, edit those notes.',
  courses: 'Courses',
  noCourses: 'No courses yet. Add `type: course` to the note of a course to list it here.',
  lectures: (count) => (count === 0 ? 'no lectures yet' : plural(count, 'lecture', 'lectures')),
  projects: 'Projects',
  noProjects: 'No projects in progress.',
  other: 'Other',
  due: (date) => `due ${formatDueDate(date, 'en')}`,
  noDeadline: 'no deadline',
  daysLeft: (days) =>
    days > 0
      ? `${plural(days, 'day', 'days')} left`
      : days === 0
        ? 'due today'
        : `${plural(-days, 'day', 'days')} overdue`,
  progress: (done, total) => `${done}/${total} tasks done`,
  noTasks: 'no tasks yet',
};

export function pageText(language: PageLanguage): PageText {
  return language === 'en' ? EN : VI;
}
