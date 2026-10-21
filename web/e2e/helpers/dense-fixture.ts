// The dense Today fixture of SPEC F10.2: 10 open tasks on one day and 30 overdue ones, every
// title 120 characters long, in one user note created through the API.
import { isoAddDays } from './app-api.js';

export const DENSE_NOTE = '1 Projects/Dày đặc e2e.md';
export const DENSE_DAY_OFFSET = 3;

const FILLER =
  ' ôn tập chương tích phân xác định và làm thêm bài tập về chuỗi số trước buổi học nhóm cuối tuần';

/** A unique title of exactly 120 characters. */
export function denseTitle(kind: 'ngày' | 'quá hạn', n: number): string {
  const head = `Việc ${kind} số ${String(n).padStart(2, '0')}:`;
  let title = head;
  while (title.length < 120) title += FILLER;
  return title.slice(0, 120).replace(/\s+$/, (spaces) => '.'.repeat(spaces.length));
}

export function denseNoteContent(today: string): string {
  const day = isoAddDays(today, DENSE_DAY_OFFSET);
  const lines = ['---', 'type: project', 'status: doing', '---', '', '# Dày đặc', ''];
  for (let i = 1; i <= 10; i += 1) lines.push(`- [ ] ${denseTitle('ngày', i)} 📅 ${day}`);
  for (let i = 1; i <= 30; i += 1) {
    lines.push(`- [ ] ${denseTitle('quá hạn', i)} 📅 ${isoAddDays(today, -i)}`);
  }
  return `${lines.join('\n')}\n`;
}
