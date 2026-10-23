import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppLayout } from '../../app/app-layout';
import { setupShell, stubViewport, teardownShell } from '../../app/__tests__/shell-test-kit';
import type { AppRouteHandle } from '../../app/routes';
import vi_ from '../../i18n/vi.json';
import { setRouteReader } from '../../lib/app-navigation';
import { usePanesStore } from '../../lib/panes-store';
import { withStyle } from '../../lib/testing/ui-style-test-kit';
import { dayCell, mockCalendar, novemberView, octoberView } from './__tests__/calendar-fixtures';
import { CalendarDayPanel } from './calendar-day-panel';
import { CalendarScreen } from './calendar-screen';
import { resetCalendarStore } from './calendar-store';

const calendarHandle: AppRouteHandle = { rightPanel: true, panel: CalendarDayPanel };

/** The real layout (rail or sidebar, bottom sheet) around the real calendar and its day panel. */
function renderCalendarShell(path = '/calendar') {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <h1>Màn hình Hôm nay</h1> },
          { path: 'calendar', element: <CalendarScreen />, handle: calendarHandle },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  setRouteReader(() => router.state.location);
  render(<RouterProvider router={router} />);
  return router;
}

const daySheet = () => screen.queryByRole('dialog', { name: vi_.panel.label });

describe.each(['bento', 'calm'] as const)('calendar on a phone, %s (F28.1)', (style) => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, 10, 0, 0));
    const mock = await setupShell();
    resetCalendarStore();
    mockCalendar(mock, { '2026-10': octoberView, '2026-11': novemberView });
    withStyle(style);
    stubViewport(360);
  });
  afterEach(() => {
    vi.useRealTimers();
    teardownShell();
  });

  it('(F28.1) a tap on a day opens its panel as the bottom sheet; Esc closes it, focus returns', async () => {
    const user = userEvent.setup();
    const router = renderCalendarShell();
    await waitFor(() =>
      expect(dayCell('2026-10-23').querySelector('.calendar-item')).not.toBeNull(),
    );
    expect(daySheet()).toBeNull();

    await user.click(dayCell('2026-10-23'));
    const sheet = await waitFor(() => daySheet() as HTMLElement);
    expect(router.state.location.search).toContain('day=2026-10-23');
    expect(
      within(sheet).getByRole('heading', { level: 2, name: 'Thứ sáu, 23 tháng 10, 2026' }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('Ôn tập kiểm tra 15 phút')).toBeInTheDocument();
    expect(sheet.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    expect(daySheet()).toBeNull();
    expect(document.activeElement).toBe(dayCell('2026-10-23'));
    // The stored side-pane preference is not touched by the sheet.
    expect(usePanesStore.getState().rightCollapsed).toBe(false);
  });

  it('(F28.1) another day after closing opens the sheet again; leaving the calendar closes it', async () => {
    const user = userEvent.setup();
    const router = renderCalendarShell('/calendar?month=2026-10&day=2026-10-23');
    await waitFor(() =>
      expect(dayCell('2026-10-20').querySelector('.calendar-item')).not.toBeNull(),
    );
    // A day already in the URL on arrival does not pop the sheet open by itself.
    expect(daySheet()).toBeNull();

    await user.click(dayCell('2026-10-20'));
    let sheet = await waitFor(() => daySheet() as HTMLElement);
    expect(
      within(sheet).getByRole('heading', { level: 2, name: 'Thứ ba, 20 tháng 10, 2026' }),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Đóng' }));
    expect(daySheet()).toBeNull();

    await user.click(dayCell('2026-10-23'));
    sheet = await waitFor(() => daySheet() as HTMLElement);
    expect(within(sheet).getByText('Ôn tập kiểm tra 15 phút')).toBeInTheDocument();

    await router.navigate('/');
    await waitFor(() => expect(daySheet()).toBeNull());
    expect(usePanesStore.getState().sheetOpen).toBe(false);
  });
});
