import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { TASKS_ROUTE } from '../../lib/app-navigation';
import type { TaskEntry } from '../../lib/api/deadlines-types';
import { isoAddDays } from '../../lib/local-day';
import { installFetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { MAX_OVERDUE_ROWS, TodayTasksSection } from './today-tasks-section';
import { taskEntry, taskItem, TODAY } from './today-test-fixtures';

const overdue = Array.from({ length: 7 }, (_, i) =>
  taskEntry(taskItem(`Bài tập quá hạn số ${i + 1}`, isoAddDays(TODAY, -7 + i))),
);
const dueToday = taskEntry(taskItem('Làm BT1 Giải tích', TODAY));

function renderSection(tasks: TaskEntry[]) {
  return render(<TodayTasksSection tasks={tasks} onItemDone={vi.fn()} refresh={vi.fn()} />);
}

/** Row titles in order. */
const titles = () =>
  screen
    .getAllByRole('checkbox')
    .map((box) => box.closest('li')?.querySelector('.deadline-row__title')?.textContent);

describe('"Hôm nay" stays calm with many overdue tasks (F10.3)', () => {
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    installFetchMock();
  });

  it('five overdue rows, then "Xem tất cả n việc quá hạn" to the Tasks view, then today\'s rows', async () => {
    const user = userEvent.setup();
    renderSection([...overdue, dueToday]);
    expect(titles()).toEqual([
      ...overdue.slice(0, MAX_OVERDUE_ROWS).map((task) => task.title),
      dueToday.title,
    ]);
    const link = screen.getByRole('link', { name: 'Xem tất cả 7 việc quá hạn' });
    expect(link).toHaveAttribute('href', `#${TASKS_ROUTE}`);
    // Between the overdue rows and today's rows.
    const lists = screen.getAllByRole('list');
    expect(within(lists[0]!).getAllByRole('listitem')).toHaveLength(MAX_OVERDUE_ROWS);
    expect(link.compareDocumentPosition(lists[1]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    await user.click(link);
    expect(navigate.mock.calls.map((call) => call[0])).toEqual([TASKS_ROUTE]);
  });

  it('a ticked overdue row keeps its place (no sixth row slides in); the link counts open ones', () => {
    renderSection([{ ...overdue[0]!, done: true }, ...overdue.slice(1), dueToday]);
    expect(titles()).toHaveLength(MAX_OVERDUE_ROWS + 1);
    expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
    expect(screen.getByRole('link', { name: 'Xem tất cả 6 việc quá hạn' })).toBeInTheDocument();
  });

  it('five overdue tasks or fewer: all listed, no link', () => {
    renderSection([...overdue.slice(0, MAX_OVERDUE_ROWS), dueToday]);
    expect(titles()).toHaveLength(MAX_OVERDUE_ROWS + 1);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
