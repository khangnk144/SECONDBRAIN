/** A weekly review answer for the web tests (shape of `GET /api/review/week`). */
import { isoAddDays } from '../../lib/local-day';
import type { ReviewNote, ReviewTask, WeekReview } from './review-api';

export function reviewNotes(count: number): ReviewNote[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `1 Projects/Ghi chú ${i + 1}.md`,
    title: `Ghi chú ${i + 1}`,
    folder: '1 Projects',
    change: i === 0 ? 'created' : 'edited',
    day: '2026-03-08',
  }));
}

export function reviewTasks(count: number): ReviewTask[] {
  return Array.from({ length: count }, (_, i) => ({
    path: '1 Projects/Đồ án Giải tích.md',
    noteTitle: 'Đồ án Giải tích',
    line: 6 + i,
    text: `Việc ${i + 1}`,
    completed: '2026-03-07',
  }));
}

export function weekReview(end: string, patch: Partial<WeekReview> = {}): WeekReview {
  const notes = reviewNotes(3);
  const tasks = reviewTasks(2);
  return {
    start: isoAddDays(end, -6),
    end,
    inbox: { count: 4 },
    notes: { count: notes.length, items: notes },
    tasksDone: { count: tasks.length, items: tasks },
    upcoming: { count: 2, from: isoAddDays(end, 1), to: isoAddDays(end, 7) },
    ...patch,
  };
}
