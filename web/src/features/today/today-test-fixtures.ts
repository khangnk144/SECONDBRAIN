/**
 * Test data for Today (used by the co-located tests only): a 60-day view starting on Tuesday
 * 20 October 2026, with Vietnamese note names that contain spaces.
 */
import { vi } from 'vitest';
import { daysBetween, parseIsoDate } from '../../editor/local-dates';
import type {
  DeadlineItem,
  PatchTaskRequest,
  ProjectSummary,
  TaskEntry,
  TodayView,
} from '../../lib/api/deadlines-types';
import { apiError, type FetchMock } from '../../lib/testing/fetch-mock';
import { isoAddDays } from '../../lib/local-day';
import { urgencyOf } from '../../editor/local-dates';

export const TODAY = '2026-10-20';
export const NOTE = '1 Projects/Đồ án Giải tích.md';

export function daysFromToday(date: string): number {
  const from = parseIsoDate(TODAY);
  const to = parseIsoDate(date);
  if (!from || !to) throw new RangeError(date);
  return daysBetween(from, to);
}

let nextLine = 10;

/** A dated task item on `date` (a fresh line number each time). */
export function taskItem(title: string, date: string, path = NOTE): DeadlineItem {
  const line = nextLine++;
  const daysLeft = daysFromToday(date);
  return {
    id: `task:${path}#${line}`,
    kind: 'task',
    title,
    date,
    path,
    noteTitle: 'Đồ án Giải tích',
    line,
    lineText: `- [ ] ${title} 📅 ${date}`,
    done: false,
    urgency: urgencyOf(daysLeft),
    daysLeft,
    class: 'user',
    revision: 'r1',
  };
}

/** The same task as Today's "Hôm nay" list shows it. */
export function taskEntry(item: DeadlineItem): TaskEntry {
  return {
    id: item.id,
    title: item.title,
    path: item.path,
    noteTitle: item.noteTitle,
    line: item.line ?? 1,
    lineText: item.lineText ?? '',
    done: item.done,
    date: item.date,
    urgency: item.urgency,
    daysLeft: item.daysLeft,
    class: item.class,
    revision: item.revision,
  };
}

export function project(overrides: Partial<ProjectSummary> = {}): ProjectSummary {
  return {
    path: NOTE,
    title: 'Đồ án Giải tích',
    deadline: '2026-11-07',
    daysLeft: 18,
    urgency: 'ok',
    progress: { done: 3, total: 5 },
    revision: 'r1',
    ...overrides,
  };
}

export interface ViewParts {
  /** Items by date (today … today+59). */
  days?: Record<string, DeadlineItem[]>;
  overdue?: DeadlineItem[];
  todayTasks?: TaskEntry[];
  projects?: ProjectSummary[];
  summary?: Partial<TodayView['summary']>;
}

export function todayView(parts: ViewParts = {}): TodayView {
  const days = Array.from({ length: 60 }, (_, i) => {
    const date = isoAddDays(TODAY, i);
    return { date, items: parts.days?.[date] ?? [] };
  });
  return {
    date: TODAY,
    week: { start: '2026-10-19', end: '2026-10-25' },
    summary: { deadlinesThisWeek: 0, openToday: 0, overdue: 0, ...parts.summary },
    strip: { days, overdue: parts.overdue ?? [] },
    todayTasks: parts.todayTasks ?? [],
    projects: parts.projects ?? [],
  };
}

/** A title of exactly `length` characters (Vietnamese, with spaces). */
export function longTitle(prefix: string, length = 120): string {
  return (prefix + ' ' + 'Ôn tập chương ba xác suất thống kê '.repeat(10)).slice(0, length);
}

/**
 * `window.matchMedia` answering `(max-width: Npx)` and reduced motion like a real window of that
 * width. Returns the function that removes the stub.
 */
export function stubWindow(width: number, reducedMotion = false): () => void {
  const matchMedia = vi.fn((query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    const matches = max ? width <= Number(max[1]) : query.includes('reduce') && reducedMotion;
    return {
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  return () => {
    delete (window as { matchMedia?: unknown }).matchMedia;
  };
}

/**
 * Gives every `.today-strip` a layout width of `width` px (jsdom has no layout) and a
 * `ResizeObserver` the test can fire. `resize(next)` changes the width and notifies the observers.
 * The scroller (what the Bento strip measures) gets the same width, less `overdueSpace` px.
 */
export function stubStripWidth(
  width: number,
  overdueSpace = 0,
): { resize: (next: number) => void } {
  let current = width;
  const callbacks = new Set<() => void>();
  class FakeResizeObserver {
    private readonly notify: () => void;
    constructor(callback: ResizeObserverCallback) {
      this.notify = () => callback([], this as unknown as ResizeObserver);
    }
    observe() {
      callbacks.add(this.notify);
    }
    unobserve() {
      callbacks.delete(this.notify);
    }
    disconnect() {
      callbacks.delete(this.notify);
    }
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const scroller = this.classList.contains('today-strip__scroller');
    if (!scroller && !this.classList.contains('today-strip')) return original.call(this);
    const measured = scroller ? current - overdueSpace : current;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: measured,
      bottom: 120,
      width: measured,
      height: 120,
    } as DOMRect;
  });
  return {
    resize: (next) => {
      current = next;
      for (const notify of [...callbacks]) notify();
    },
  };
}

/**
 * `PATCH /api/note/task` answered like the server: one revision per note, and a write is refused
 * (409) unless it carries the note's current revision and the line still reads `expectedText`.
 * Every item starts at revision `r1`.
 */
export function fakeTaskServer(mock: FetchMock, items: DeadlineItem[]): void {
  const revisions = new Map<string, number>();
  const lines = new Map<string, string>();
  for (const item of items) lines.set(`${item.path}#${item.line}`, item.lineText ?? '');
  mock.on('PATCH /api/note/task', (call) => {
    const body = call.body as PatchTaskRequest;
    const revision = revisions.get(body.path) ?? 1;
    const key = `${body.path}#${body.line}`;
    if (body.expectedRevision !== `r${revision}` || lines.get(key) !== body.expectedText) {
      return apiError(409, 'CONFLICT', { reason: 'revision', currentRevision: `r${revision}` });
    }
    const lineText = body.done
      ? `${body.expectedText.replace('[ ]', '[x]')} ✅ ${TODAY}`
      : body.expectedText.replace('[x]', '[ ]').replace(/ ✅ \S+$/, '');
    lines.set(key, lineText);
    revisions.set(body.path, revision + 1);
    return { body: { revision: `r${revision + 1}`, lineText } };
  });
}
