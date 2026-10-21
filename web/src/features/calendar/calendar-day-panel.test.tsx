import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setAppNavigator, type Navigator } from '../../lib/app-navigation';
import { apiError, type FetchMock } from '../../lib/testing/fetch-mock';
import { useTabsStore } from '../../lib/tabs-store';
import {
  doneTask,
  mockCalendar,
  novemberExam,
  novemberView,
  octoberView,
  projectDeadline,
  quiz,
  readPaper,
  dayCell,
  renderCalendar,
  setupCalendarTest,
  submitDraft,
  teardownCalendarTest,
} from './__tests__/calendar-fixtures';

const pane = () => screen.getByRole('complementary', { name: 'Ngăn phải' });

/** A window `width` px wide for `(max-width: …)` queries; reduced motion off. */
function stubWindowWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const max = /max-width:\s*([\d.]+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

describe('calendar day pane (F11.1, F13.1)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupCalendarTest();
    mockCalendar(mock, { '2026-10': octoberView, '2026-11': novemberView });
  });
  afterEach(teardownCalendarTest);

  it('without an opened day it invites a click', () => {
    renderCalendar('/calendar');
    expect(within(pane()).getByRole('heading', { name: 'Ngày bạn chọn' })).toBeInTheDocument();
    expect(mock.callsTo('GET /api/daily')).toHaveLength(0);
  });

  it("lists the day's items with tick, menu and open buttons; done ones ticked", async () => {
    renderCalendar('/calendar?month=2026-10&day=2026-10-20');
    const list = await within(pane()).findByRole('list', { name: 'Việc trong ngày' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.deadline-row__title')?.textContent)).toEqual([
      submitDraft.title,
      doneTask.title,
      projectDeadline.title,
      readPaper.title,
    ]);
    expect(within(list).getByRole('checkbox', { name: doneTask.title })).toBeChecked();
    expect(within(list).getByRole('checkbox', { name: submitDraft.title })).not.toBeChecked();
    expect(
      within(rows[0]!).getByRole('button', { name: `Thao tác với “${submitDraft.title}”` }),
    ).toHaveAttribute('aria-haspopup', 'menu');
    // The title itself opens the note; the note it lives in is its description.
    const open = within(rows[0]!).getByRole('button', { name: `Mở ghi chú ${submitDraft.title}` });
    expect(open).toHaveAccessibleDescription(submitDraft.noteTitle);
    expect(within(pane()).getByText('Hôm nay')).toBeInTheDocument();
    // One request for the month: the pane reads the screen's data.
    expect(mock.callsTo('GET /api/calendar')).toHaveLength(1);
  });

  it('an empty day says so; "Viết" creates the missing daily note through POST and opens it', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/daily', {
      status: 201,
      body: { path: 'Daily/2026-10-21.md', revision: 'r-d', cursor: 42 },
    });
    const navigate = vi.fn<Navigator>();
    setAppNavigator(navigate);
    renderCalendar('/calendar?month=2026-10&day=2026-10-21');
    await waitFor(() =>
      expect(within(pane()).getByText('Ngày này chưa có việc nào.')).toBeInTheDocument(),
    );
    expect(within(pane()).getByText(/Kéo một việc trên lịch thả vào ngày này/)).toBeInTheDocument();
    const write = await within(pane()).findByRole('button', { name: 'Viết' });
    expect(within(pane()).getByText('Ngày này chưa có ghi chú.')).toBeInTheDocument();
    expect(mock.callsTo('GET /api/daily')[0]?.query.get('date')).toBe('2026-10-21');
    expect(mock.callsTo('POST /api/daily')).toHaveLength(0);
    await user.click(write);
    await waitFor(() => expect(mock.callsTo('POST /api/daily')).toHaveLength(1));
    expect(mock.callsTo('POST /api/daily')[0]?.body).toEqual({ date: '2026-10-21' });
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['Daily/2026-10-21.md']),
    );
    expect(navigate).toHaveBeenCalledWith('/note?path=Daily%2F2026-10-21.md&cursor=42', undefined);
  });

  it('an existing daily note offers "Mở ghi chú ngày", which opens it without creating', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/daily', { body: { path: 'Daily/2026-10-20.md', revision: 'r-d' } });
    renderCalendar('/calendar?month=2026-10&day=2026-10-20');
    await user.click(await within(pane()).findByRole('button', { name: 'Mở ghi chú ngày' }));
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['Daily/2026-10-20.md']),
    );
    expect(mock.callsTo('POST /api/daily')).toHaveLength(0);
    expect(within(pane()).queryByRole('button', { name: 'Viết' })).toBeNull();
  });

  it('a daily check that failed still offers "Viết"', async () => {
    mock.on('GET /api/daily', apiError(500, 'INTERNAL'));
    renderCalendar('/calendar?month=2026-10&day=2026-10-21');
    expect(await within(pane()).findByRole('button', { name: 'Viết' })).toBeInTheDocument();
  });

  it('a month that cannot load says so in the screen and the pane; "Thử lại" asks again', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/calendar', apiError(500, 'INTERNAL'));
    renderCalendar('/calendar?month=2026-10&day=2026-10-23');
    const message = await screen.findByText(/^Chưa tải được lịch tháng này\./);
    const alert = message.closest<HTMLElement>('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(within(pane()).getByText('Chưa tải được việc của ngày này.')).toBeInTheDocument();
    mockCalendar(mock, { '2026-10': octoberView });
    await user.click(within(alert!).getByRole('button', { name: 'Thử lại' }));
    await waitFor(() => expect(screen.queryByText(/^Chưa tải được lịch tháng này/)).toBeNull());
    expect(await within(pane()).findByText(quiz.title)).toBeInTheDocument();
  });

  it('an opened day outside the month on screen loads its own month', async () => {
    renderCalendar('/calendar?month=2026-10&day=2026-11-05');
    const list = await within(pane()).findByRole('list', { name: 'Việc trong ngày' });
    expect(within(list).getByText(novemberExam.title)).toBeInTheDocument();
    expect(
      mock
        .callsTo('GET /api/calendar')
        .map((c) => c.query.get('month'))
        .sort(),
    ).toEqual(['2026-10', '2026-11']);
  });

  it.each([
    [800, 1],
    [1280, 0],
  ])(
    'a %i px window: opening a day scrolls the stacked pane into view %i time(s), focus stays on the cell',
    async (width, scrolls) => {
      const user = userEvent.setup();
      stubWindowWidth(width);
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      renderCalendar('/calendar?month=2026-10');
      await waitFor(() => expect(dayCell('2026-10-23').textContent).toContain(quiz.title));
      await user.click(dayCell('2026-10-23'));
      const heading = await within(pane()).findByRole('heading', {
        level: 2,
        name: 'Thứ sáu, 23 tháng 10, 2026',
      });
      expect(scrollIntoView).toHaveBeenCalledTimes(scrolls);
      if (scrolls > 0) {
        expect(scrollIntoView.mock.contexts[0]).toBe(heading);
        expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
      }
      expect(document.activeElement).toBe(dayCell('2026-10-23'));
    },
  );
});
