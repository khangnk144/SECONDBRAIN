import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { usePanesStore } from '../../lib/panes-store';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import {
  cellTitles,
  mockCalendar,
  novemberExam,
  novemberView,
  octoberView,
  PROJECT,
  renderCalendar,
  setupCalendarTest,
  teardownCalendarTest,
} from './__tests__/calendar-fixtures';

/** The date of the focused day cell. */
function focusedDate(): string | null {
  const active = document.activeElement as HTMLElement | null;
  return active?.getAttribute('role') === 'gridcell' ? active.getAttribute('data-date') : null;
}

const monthHeading = () => screen.getByRole('heading', { level: 1 }).textContent;

describe('calendar by keyboard only (F11.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupCalendarTest();
    mockCalendar(mock, { '2026-10': octoberView, '2026-11': novemberView });
    mock.on('POST /api/note/reschedule', { body: { revision: 'rev-2', journalId: 'j-1' } });
  });
  afterEach(teardownCalendarTest);

  it('one tab stop; arrows, Home/End and PageUp/PageDown move days and cross months', async () => {
    const user = userEvent.setup();
    const { router } = renderCalendar('/calendar');
    const stops = document.querySelectorAll('[role="gridcell"][tabindex="0"]');
    expect(stops).toHaveLength(1);
    // Header: three month buttons and the archive toggle, then the grid on today.
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(focusedDate()).toBe('2026-10-20');

    await user.keyboard('{ArrowRight}');
    expect(focusedDate()).toBe('2026-10-21');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    // 4 November: the month follows the focused day and loads.
    await waitFor(() => expect(focusedDate()).toBe('2026-11-04'));
    expect(monthHeading()).toBe('Lịch, Tháng 11, 2026');
    expect(router.state.location.search).toBe('?month=2026-11');
    await waitFor(() => expect(cellTitles('2026-11-05')).toEqual([novemberExam.title]));

    await user.keyboard('{PageUp}');
    await waitFor(() => expect(focusedDate()).toBe('2026-10-04'));
    expect(monthHeading()).toBe('Lịch, Tháng 10, 2026');
    await user.keyboard('{PageDown}');
    await waitFor(() => expect(focusedDate()).toBe('2026-11-04'));
    await user.keyboard('{Home}');
    expect(focusedDate()).toBe('2026-11-02');
    await user.keyboard('{End}');
    expect(focusedDate()).toBe('2026-11-08');
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => expect(focusedDate()).toBe('2026-10-25'));
    expect(monthHeading()).toBe('Lịch, Tháng 10, 2026');
    expect(document.querySelectorAll('[role="gridcell"][tabindex="0"]')).toHaveLength(1);
    expect(mock.callsTo('GET /api/calendar').map((c) => c.query.get('month'))).toEqual([
      '2026-10',
      '2026-11',
      '2026-10',
      '2026-11',
      '2026-10',
    ]);
  });

  it('Enter opens the day in the pane; the menu and the date picker reschedule without a mouse', async () => {
    const user = userEvent.setup();
    usePanesStore.setState({ rightCollapsed: true });
    const { router } = renderCalendar('/calendar?month=2026-11');
    await waitFor(() => expect(cellTitles('2026-11-05')).toEqual([novemberExam.title]));
    for (let i = 0; i < 5; i += 1) await user.tab();
    // Today is not in November: the tab stop starts on the 1st.
    expect(focusedDate()).toBe('2026-11-01');
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}');
    expect(focusedDate()).toBe('2026-11-05');
    await user.keyboard('{Enter}');
    expect(router.state.location.search).toBe('?month=2026-11&day=2026-11-05');
    expect(usePanesStore.getState().rightCollapsed).toBe(false);
    expect(focusedDate()).toBe('2026-11-05');
    const pane = screen.getByRole('complementary', { name: 'Ngăn phải' });
    expect(within(pane).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Thứ năm, 5 tháng 11, 2026',
    );

    // Tab leaves the grid for the pane: the item's checkbox, its title (opens the note), then
    // its menu button.
    await user.tab();
    expect(document.activeElement).toBe(
      within(pane).getByRole('checkbox', { name: novemberExam.title }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      within(pane).getByRole('button', { name: `Mở ghi chú ${novemberExam.title}` }),
    );
    await user.tab();
    expect(document.activeElement).toBe(
      within(pane).getByRole('button', { name: `Thao tác với “${novemberExam.title}”` }),
    );
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Dời ngày…' }));
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('dialog', { name: `Dời “${novemberExam.title}” sang ngày` }),
    ).toBeInTheDocument();
    // The picker starts on the item's date; one day later, Enter picks it.
    expect(document.activeElement?.textContent).toBe('5');
    await user.keyboard('{ArrowRight}{Enter}');
    await waitFor(() => expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toEqual({
      path: PROJECT,
      expectedRevision: 'rev-1',
      target: { kind: 'task', line: 30, expectedText: novemberExam.lineText },
      date: '2026-11-06',
    });
  });
});
