/** Test helpers for the calendar: month fixtures, a mocked `GET /calendar`, a router render. */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { vi } from 'vitest';
import type { CalendarView, DeadlineItem } from '../../../lib/api/deadlines-types';
import { resetAppState } from '../../../lib/testing/reset-app-state';
import { installFetchMock, type FetchMock } from '../../../lib/testing/fetch-mock';
import { DialogHost } from '../../dialogs/dialog-host';
import { ToastHost } from '../../toasts/toast-host';
import { CalendarDayPanel } from '../calendar-day-panel';
import { monthGridDates } from '../calendar-month-model';
import { CalendarScreen } from '../calendar-screen';
import { resetCalendarStore } from '../calendar-store';

export const TODAY = '2026-10-20';
export const PROJECT = '1 Projects/Đồ án Giải tích.md';
export const ARCHIVED = '4 Archive/Môn cũ.md';

function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function taskItem(
  title: string,
  date: string,
  line: number,
  extra: Partial<DeadlineItem> = {},
) {
  const daysLeft = daysBetweenIso(TODAY, date);
  const done = extra.done ?? false;
  const urgency = done ? 'done' : daysLeft <= 2 ? 'urgent' : daysLeft <= 7 ? 'soon' : 'ok';
  const item: DeadlineItem = {
    id: `task:${extra.path ?? PROJECT}#${line}`,
    kind: 'task',
    title,
    date,
    path: PROJECT,
    noteTitle: 'Đồ án Giải tích',
    line,
    lineText: `- [${done ? 'x' : ' '}] ${title} 📅 ${date}`,
    done,
    urgency,
    daysLeft,
    class: 'user',
    revision: 'rev-1',
    ...extra,
  };
  return item;
}

export function noteItem(
  title: string,
  date: string,
  path: string,
  extra: Partial<DeadlineItem> = {},
) {
  return taskItem(title, date, 0, {
    id: `note:${path}`,
    kind: 'note',
    path,
    noteTitle: title,
    line: null,
    lineText: null,
    ...extra,
  });
}

/** A month view as `GET /calendar` answers it, with `items` on the given dates. */
export function makeView(month: string, items: Record<string, DeadlineItem[]>): CalendarView {
  const weeks = monthGridDates(month);
  const dates = weeks.flat();
  return {
    month,
    start: dates[0]!,
    end: dates[dates.length - 1]!,
    days: dates.map((date) => ({
      date,
      inMonth: date.startsWith(month),
      items: items[date] ?? [],
    })),
  };
}

export const submitDraft = taskItem('Nộp bản nháp chương 2', '2026-10-20', 12);
export const readPaper = taskItem('Đọc bài báo về ma trận', '2026-10-20', 14);
export const doneTask = taskItem('Gửi email cho thầy', '2026-10-20', 9, { done: true });
export const projectDeadline = noteItem('Đồ án Giải tích', '2026-10-20', PROJECT);
export const quiz = taskItem('Ôn tập kiểm tra 15 phút', '2026-10-23', 20);
export const archivedDeadline = noteItem('Môn cũ', '2026-10-22', ARCHIVED, { class: 'archived' });
export const novemberExam = taskItem('Thi giữa kỳ', '2026-11-05', 30);

/** October 2026 with four items on the 20th (one done), one on the 23rd; archived only on request. */
export function octoberView(includeArchive: boolean): CalendarView {
  return makeView('2026-10', {
    '2026-10-20': [submitDraft, doneTask, projectDeadline, readPaper],
    '2026-10-23': [quiz],
    ...(includeArchive ? { '2026-10-22': [archivedDeadline] } : {}),
  });
}

export function novemberView(): CalendarView {
  return makeView('2026-11', { '2026-11-05': [novemberExam] });
}

/** Mocks `GET /calendar` from a table of months; unknown months come back empty. */
export function mockCalendar(
  mock: FetchMock,
  months: Record<string, (includeArchive: boolean) => CalendarView>,
): void {
  mock.on('GET /api/calendar', (call) => {
    const month = call.query.get('month') ?? '';
    const includeArchive = call.query.get('includeArchive') === 'true';
    const view = months[month]?.(includeArchive) ?? makeView(month, {});
    return { body: view };
  });
  mock.on('GET /api/daily', { status: 404, body: { error: { code: 'NOT_FOUND', message: 'x' } } });
}

/** Clean stores, `today` = 2026-10-20 (only `Date` is faked), a fetch mock. */
export async function setupCalendarTest(): Promise<FetchMock> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 20, 10, 0, 0));
  await resetAppState('vault-a');
  resetCalendarStore();
  return installFetchMock();
}

export function teardownCalendarTest(): void {
  vi.useRealTimers();
  vi.unstubAllGlobals();
}

/** The calendar screen with its right pane, toasts and dialogs, at `path`. */
export function renderCalendar(path = '/calendar') {
  const router = createMemoryRouter(
    [
      {
        path: '/calendar',
        element: (
          <>
            <main>
              <CalendarScreen />
            </main>
            <aside aria-label="Ngăn phải">
              <CalendarDayPanel />
            </aside>
            <ToastHost />
            <DialogHost />
          </>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(<RouterProvider router={router} />);
  return { router, ...view };
}

/** A day cell by its date. */
export function dayCell(date: string): HTMLElement {
  const cell = document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`);
  if (!cell) throw new Error(`no cell for ${date}`);
  return cell;
}

/** Titles listed in a day cell, in order. */
export function cellTitles(date: string): string[] {
  return [...dayCell(date).querySelectorAll('.calendar-item__title')].map(
    (n) => n.textContent ?? '',
  );
}

/** A stand-in for the browser's DataTransfer (jsdom has none). */
export function fakeDataTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    dropEffect: 'none',
    effectAllowed: 'all',
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? '',
    types: [] as string[],
  };
}
