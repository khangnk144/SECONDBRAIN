import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n } from '../../i18n';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { usePanesStore } from '../../lib/panes-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import {
  archivedDeadline,
  cellTitles,
  dayCell,
  doneTask,
  makeView,
  mockCalendar,
  novemberView,
  octoberView,
  projectDeadline,
  quiz,
  renderCalendar,
  setupCalendarTest,
  submitDraft,
  teardownCalendarTest,
} from './__tests__/calendar-fixtures';
import { resetCalendarStore } from './calendar-store';

const calendarCalls = (mock: FetchMock) =>
  mock.callsTo('GET /api/calendar').map((c) => c.query.toString());

describe('calendar month grid (F11.1)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupCalendarTest();
    mockCalendar(mock, { '2026-10': octoberView, '2026-11': novemberView });
  });
  afterEach(teardownCalendarTest);

  it('lists exactly the service items per day: 3 then "+n", done struck through, Monday first', async () => {
    renderCalendar('/calendar');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lịch, Tháng 10, 2026' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(cellTitles('2026-10-20')).toHaveLength(3));
    expect(calendarCalls(mock)).toEqual(['month=2026-10']);
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers[0]).toBe('T2Thứ hai');
    expect(headers[6]).toBe('CNChủ nhật');

    expect(cellTitles('2026-10-20')).toEqual([
      submitDraft.title,
      doneTask.title,
      projectDeadline.title,
    ]);
    expect(within(dayCell('2026-10-20')).getByText('+1')).toBeInTheDocument();
    expect(cellTitles('2026-10-23')).toEqual([quiz.title]);
    // Every other day of the fixture is empty, the archived item absent without the toggle.
    const filled = [...document.querySelectorAll('[role="gridcell"]')].filter(
      (cell) => cell.querySelector('.calendar-item') !== null,
    );
    expect(filled.map((cell) => cell.getAttribute('data-date'))).toEqual([
      '2026-10-20',
      '2026-10-23',
    ]);

    const done = dayCell('2026-10-20').querySelector(`[data-item-id="${doneTask.id}"]`);
    expect(done).toHaveClass('is-done');
    expect(done).toHaveAttribute('draggable', 'false');
    expect(
      dayCell('2026-10-20').querySelector(`[data-item-id="${submitDraft.id}"]`),
    ).toHaveAttribute('draggable', 'true');
    // Neighbouring months dimmed; today marked; the accessible name names the first three
    // items and counts the rest (short to listen to on every arrow key); empty days say so.
    expect(dayCell('2026-09-28')).toHaveClass('is-outside');
    expect(dayCell('2026-10-20')).toHaveAttribute('aria-current', 'date');
    expect(
      screen.getByRole('gridcell', {
        name:
          'Thứ ba, 20 tháng 10, 2026, hôm nay, 4 việc: Nộp bản nháp chương 2, ' +
          'Gửi email cho thầy (đã xong), Đồ án Giải tích và 1 việc khác',
      }),
    ).toBeInTheDocument();
    expect(dayCell('2026-10-23')).toHaveAccessibleName(
      `Thứ sáu, 23 tháng 10, 2026, 1 việc: ${quiz.title}`,
    );
    expect(dayCell('2026-10-21')).toHaveAccessibleName(
      'Thứ tư, 21 tháng 10, 2026, chưa có việc nào',
    );
  });

  it('"Bao gồm Archive" adds archived items, is remembered per vault and survives a reload', async () => {
    const user = userEvent.setup();
    const first = renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    expect(cellTitles('2026-10-22')).toEqual([]);
    await user.click(screen.getByRole('checkbox', { name: 'Bao gồm Archive' }));
    await waitFor(() => expect(cellTitles('2026-10-22')).toEqual([archivedDeadline.title]));
    expect(calendarCalls(mock)).toEqual(['month=2026-10', 'month=2026-10&includeArchive=true']);
    expect(localStorage.getItem('sb:vault-a:calendar.includeArchive')).toBe('true');

    first.unmount();
    resetCalendarStore();
    renderCalendar('/calendar');
    expect(screen.getByRole('checkbox', { name: 'Bao gồm Archive' })).toBeChecked();
    await waitFor(() => expect(cellTitles('2026-10-22')).toEqual([archivedDeadline.title]));
    expect(calendarCalls(mock).at(-1)).toBe('month=2026-10&includeArchive=true');
  });

  it('stays live: a vault event reloads the month and a moved item changes day', async () => {
    renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    const movedQuiz = { ...quiz, date: '2026-10-27' };
    mockCalendar(mock, { '2026-10': () => makeView('2026-10', { '2026-10-27': [movedQuiz] }) });
    act(() => emitServerEvent({ type: 'note:changed', path: quiz.path, revision: 'rev-2' }));
    await waitFor(() => expect(cellTitles('2026-10-27')).toEqual([quiz.title]));
    expect(cellTitles('2026-10-23')).toEqual([]);
  });

  it('URL state round trip: month and opened day read, buttons write them back (replace)', async () => {
    const user = userEvent.setup();
    const { router } = renderCalendar('/calendar?month=2026-11&day=2026-11-05');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lịch, Tháng 11, 2026' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(cellTitles('2026-11-05')).toEqual(['Thi giữa kỳ']));
    expect(dayCell('2026-11-05')).toHaveAttribute('aria-selected', 'true');
    expect(
      screen.getByRole('heading', { level: 2, name: 'Thứ năm, 5 tháng 11, 2026' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tháng sau' }));
    expect(router.state.location.search).toBe('?month=2026-12&day=2026-11-05');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Lịch, Tháng 12, 2026' }),
    ).toBeInTheDocument();
    // The opened day stays in the pane while another month is browsed.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Thứ năm, 5 tháng 11, 2026' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hôm nay' }));
    expect(router.state.location.search).toBe('?month=2026-10&day=2026-10-20');
    await user.click(dayCell('2026-10-23'));
    expect(router.state.location.search).toBe('?month=2026-10&day=2026-10-23');
    await user.click(screen.getByRole('button', { name: 'Tháng trước' }));
    expect(router.state.location.search).toBe('?month=2026-09&day=2026-10-23');
  });

  it('opening a day expands a collapsed right pane', async () => {
    const user = userEvent.setup();
    usePanesStore.setState({ rightCollapsed: true });
    renderCalendar('/calendar');
    await user.click(dayCell('2026-10-23'));
    expect(usePanesStore.getState().rightCollapsed).toBe(false);
  });

  it('English month title and weekday names', async () => {
    await i18n.changeLanguage('en');
    renderCalendar('/calendar?month=2026-10');
    expect(
      screen.getByRole('heading', { level: 1, name: 'Calendar, October 2026' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')[0]?.textContent).toBe('MonMonday');
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeInTheDocument();
    await i18n.changeLanguage('vi');
  });
});
