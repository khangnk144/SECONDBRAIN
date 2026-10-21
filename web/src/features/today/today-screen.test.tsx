import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { useTabsStore } from '../../lib/tabs-store';
import { useToastStore } from '../../lib/toast-store';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { DEFAULT_UI_PREFS } from '../../lib/ui-prefs';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { useConnectionStore } from '../../lib/ws/connection-store';
import { resetStripIntro } from './strip-intro';
import { TodayScreen } from './today-screen';
import {
  fakeTaskServer,
  stubWindow,
  taskEntry,
  taskItem,
  TODAY,
  todayView,
} from './today-test-fixtures';

const late = taskItem('Bài tập tuần trước', '2026-10-19');
const dueToday = taskItem('Làm BT1 Giải tích', TODAY);
const tomorrow = taskItem('Nộp bản nháp', '2026-10-21');
const VIEW = todayView({
  days: { [TODAY]: [dueToday], '2026-10-21': [tomorrow] },
  overdue: [late],
  todayTasks: [taskEntry(late), taskEntry(dueToday)],
  // Counted once each, as the server does: the overdue task only as overdue.
  summary: { overdue: 1, deadlinesThisWeek: 2, openToday: 1 },
});

describe('Today screen', () => {
  let mock: FetchMock;
  let restoreWindow: () => void = () => undefined;
  beforeEach(async () => {
    await resetAppState();
    resetStripIntro();
    restoreWindow = stubWindow(1280);
    useUiPrefsStore.getState().setPrefs({ ...DEFAULT_UI_PREFS, name: 'khangnie' });
    mock = installFetchMock();
    mock.on('GET /api/today', { body: VIEW });
    mock.on('GET /api/sample-data', { body: { offered: false, present: false } });
  });
  afterEach(() => {
    restoreWindow();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    [4, 59, 'Chào khuya, khangnie.', 'Up late, khangnie.'],
    [5, 0, 'Chào buổi sáng, khangnie.', 'Good morning, khangnie.'],
    [11, 0, 'Chào buổi trưa, khangnie.', 'Good midday, khangnie.'],
    [13, 30, 'Chào buổi chiều, khangnie.', 'Good afternoon, khangnie.'],
    [18, 0, 'Chào buổi tối, khangnie.', 'Good evening, khangnie.'],
    [23, 0, 'Chào khuya, khangnie.', 'Up late, khangnie.'],
  ])('greets by the time of day at %i:%i (F10.1)', async (hours, minutes, vi_, en) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 20, hours, minutes));
    const { unmount } = render(<TodayScreen />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(vi_);
    expect(screen.getByText('Thứ ba, 20 tháng 10')).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(en);
    unmount();
  });

  it('ticking in "Hôm nay" updates the summary before the refetch answers (F10.4)', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: '- [x] Làm BT1' } });
    render(<TodayScreen />);
    expect(
      await screen.findByText('Có 1 việc quá hạn. Tuần này có 2 deadline. Hôm nay còn 1 việc.'),
    ).toBeInTheDocument();
    let answerRefetch: () => void = () => undefined;
    mock.on(
      'GET /api/today',
      () => new Promise((resolve) => (answerRefetch = () => resolve({ body: VIEW }))),
    );

    await user.click(screen.getByRole('checkbox', { name: dueToday.title }));
    await waitFor(() =>
      expect(screen.getByText('Có 1 việc quá hạn. Tuần này có 1 deadline.')).toBeInTheDocument(),
    );
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({
      path: dueToday.path,
      line: dueToday.line,
      expectedText: dueToday.lineText,
      done: true,
    });
    // The server's event brings the fresh view; until it answers the local picture stays.
    act(() => emitServerEvent({ type: 'note:changed', path: dueToday.path, revision: 'r2' }));
    await waitFor(() => expect(mock.callsTo('GET /api/today').length).toBe(2));
    expect(screen.getByText('Có 1 việc quá hạn. Tuần này có 1 deadline.')).toBeInTheDocument();
    answerRefetch(); // this fake server still reports the old counts: the fresh view wins
    expect(await screen.findByText(/Hôm nay còn 1 việc\./)).toBeInTheDocument();
  });

  it('keyboard only: Tab reaches the strip, arrows move, Enter opens, Space ticks, Esc returns (F10.3)', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: '- [x] Nộp bản nháp' } });
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });

    await user.tab();
    expect(document.activeElement).toHaveAccessibleName('Hôm nay, thứ ba, 20 tháng 10: 1 việc');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toHaveAccessibleName('Quá hạn: 1 việc');
    await user.keyboard('{End}');
    expect(document.activeElement).toHaveAccessibleName('Thứ sáu, 18 tháng 12: chưa có việc nào');
    expect(scrollIntoView).toHaveBeenCalled();
    await user.keyboard('{Home}{ArrowRight}{ArrowRight}');
    const cell = document.activeElement as HTMLElement;
    expect(cell).toHaveAccessibleName('Thứ tư, 21 tháng 10: 1 việc');

    await user.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Thứ tư, 21 tháng 10' });
    expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: tomorrow.title }));
    await user.keyboard(' ');
    await waitFor(() => expect(mock.callsTo('PATCH /api/note/task')).toHaveLength(1));
    await user.tab(); // the title is the "open note" control
    expect(document.activeElement).toHaveAccessibleName(`Mở ghi chú ${tomorrow.title}`);
    await user.tab(); // wraps inside the dialog
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(cell);

    // Leaving the strip takes one Tab: it is a single tab stop.
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName(late.title);
  });

  it('opens a note from the popover by keyboard', async () => {
    const user = userEvent.setup();
    render(<TodayScreen />);
    await screen.findByRole('group', { name: 'Các ngày tới' });
    await user.tab();
    await user.keyboard('{Enter}');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([dueToday.path]);
  });

  it('while the server is unreachable the inline banner replaces the summary line', async () => {
    render(<TodayScreen />);
    await screen.findByText(/Hôm nay còn 1 việc\./);
    act(() => useConnectionStore.setState({ state: 'closed', closedSince: Date.now() - 5_000 }));
    expect(await screen.findByText(/Chưa kết nối với máy chủ/)).toBeInTheDocument();
    expect(screen.queryByText(/Hôm nay còn 1 việc\./)).toBeNull();
  });

  it('a fresh vault gets the sample-data card at the top; it hides while offline', async () => {
    mock.on('GET /api/sample-data', { body: { offered: true, present: false } });
    render(<TodayScreen />);
    const card = await screen.findByRole('region', { name: 'Tạo dữ liệu mẫu để xem thử?' });
    expect(card.compareDocumentPosition(screen.getByRole('heading', { level: 1 }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    act(() => useConnectionStore.setState({ state: 'closed', closedSince: Date.now() - 5_000 }));
    await screen.findByText(/Chưa kết nối với máy chủ/);
    expect(screen.queryByRole('region', { name: 'Tạo dữ liệu mẫu để xem thử?' })).toBeNull();
  });

  it('a row that leaves "Hôm nay" (ticked elsewhere) hands focus to the next row', async () => {
    render(<TodayScreen />);
    const box = await screen.findByRole('checkbox', { name: late.title });
    act(() => box.focus());
    // Ticked in the editor: the fresh view no longer lists it.
    const fresh = todayView({
      days: { [TODAY]: [dueToday], '2026-10-21': [tomorrow] },
      todayTasks: [taskEntry(dueToday)],
      summary: { overdue: 0, deadlinesThisWeek: 2, openToday: 1 },
    });
    mock.on('GET /api/today', { body: fresh });
    act(() => emitServerEvent({ type: 'note:changed', path: late.path, revision: 'r2' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: late.title })).toBeNull());
    expect(screen.getByRole('checkbox', { name: dueToday.title })).toHaveFocus();
    expect(screen.queryByRole('button', { name: /^Quá hạn/ })).toBeNull();
  });

  it('a task ticked in "Hôm nay" stays there, checked and dimmed, until Today closes; it can be unticked there', async () => {
    const user = userEvent.setup();
    fakeTaskServer(mock, [late, dueToday, tomorrow]);
    const { unmount } = render(<TodayScreen />);
    const tasks = await screen.findByRole('region', { name: 'Hôm nay' });
    await user.click(within(tasks).getByRole('checkbox', { name: late.title }));
    // Counted as done at once.
    expect(
      await screen.findByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.'),
    ).toBeInTheDocument();

    // The server's fresh view leaves the done task out; the row stays where it was.
    const fresh = todayView({
      days: { [TODAY]: [dueToday], '2026-10-21': [tomorrow] },
      todayTasks: [taskEntry(dueToday)],
      summary: { overdue: 0, deadlinesThisWeek: 2, openToday: 1 },
    });
    mock.on('GET /api/today', { body: fresh });
    act(() => emitServerEvent({ type: 'note:changed', path: late.path, revision: 'r2' }));
    await waitFor(() => expect(mock.callsTo('GET /api/today')).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Quá hạn/ })).toBeNull());
    const rows = () => within(tasks).getAllByRole('checkbox');
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toHaveAccessibleName(late.title);
    expect(rows()[0]).toBeChecked();
    expect(rows()[0]?.closest('li')).toHaveClass('is-done');
    expect(screen.getByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.')).toBeInTheDocument();

    // An accidental tick is undone right there, and counts as open again at once.
    let answerRefetch: () => void = () => undefined;
    mock.on(
      'GET /api/today',
      () => new Promise((resolve) => (answerRefetch = () => resolve({ body: VIEW }))),
    );
    await user.click(rows()[0]!);
    expect(
      await screen.findByText('Có 1 việc quá hạn. Tuần này có 2 deadline. Hôm nay còn 1 việc.'),
    ).toBeInTheDocument();
    expect(rows()[0]).not.toBeChecked();
    expect(mock.callsTo('PATCH /api/note/task').map((c) => c.body)).toEqual([
      expect.objectContaining({ expectedRevision: 'r1', done: true }),
      expect.objectContaining({
        expectedRevision: 'r2',
        expectedText: `${late.lineText!.replace('[ ]', '[x]')} ✅ ${TODAY}`,
        done: false,
      }),
    ]);
    act(() => answerRefetch());
    expect(useToastStore.getState().toasts).toEqual([]);

    // Ticked again, then Today closes: the next visit shows the server's list only.
    mock.on('GET /api/today', { body: fresh });
    await user.click(rows()[0]!);
    await screen.findByText('Tuần này có 2 deadline. Hôm nay còn 1 việc.');
    unmount();
    render(<TodayScreen />);
    expect(await screen.findByRole('checkbox', { name: dueToday.title })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: late.title })).toBeNull();
  });

  it('two tasks of one note ticked one after the other both go through, one request each', async () => {
    const user = userEvent.setup();
    fakeTaskServer(mock, [late, dueToday, tomorrow]);
    render(<TodayScreen />);
    const tasks = await screen.findByRole('region', { name: 'Hôm nay' });
    // No refetch answers in between: both rows still hold the revision the view loaded.
    mock.on('GET /api/today', () => new Promise(() => undefined));
    await user.click(within(tasks).getByRole('checkbox', { name: late.title }));
    await user.click(within(tasks).getByRole('checkbox', { name: dueToday.title }));
    expect(await screen.findByText('Tuần này có 1 deadline.')).toBeInTheDocument();
    expect(
      mock.callsTo('PATCH /api/note/task').map((c) => (c.body as { line: number }).line),
    ).toEqual([late.line, dueToday.line]);
    expect(within(tasks).getAllByRole('checkbox', { checked: true })).toHaveLength(2);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('an item ticked in a strip popover stays listed while the popover is open', async () => {
    const user = userEvent.setup();
    fakeTaskServer(mock, [late, dueToday, tomorrow]);
    render(<TodayScreen />);
    await user.click(await screen.findByRole('button', { name: 'Thứ tư, 21 tháng 10: 1 việc' }));
    const dialog = screen.getByRole('dialog', { name: 'Thứ tư, 21 tháng 10' });
    await user.click(within(dialog).getByRole('checkbox', { name: tomorrow.title }));
    await screen.findByText('Có 1 việc quá hạn. Tuần này có 1 deadline. Hôm nay còn 1 việc.');
    mock.on('GET /api/today', {
      body: todayView({
        days: { [TODAY]: [dueToday] },
        overdue: [late],
        todayTasks: [taskEntry(late), taskEntry(dueToday)],
        summary: { overdue: 1, deadlinesThisWeek: 1, openToday: 1 },
      }),
    });
    act(() => emitServerEvent({ type: 'note:changed', path: tomorrow.path, revision: 'r2' }));
    await waitFor(() => expect(mock.callsTo('GET /api/today')).toHaveLength(2));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Thứ tư, 21 tháng 10: chưa có việc nào' }),
      ).toBeInTheDocument(),
    );
    expect(within(dialog).getByRole('checkbox', { name: tomorrow.title })).toBeChecked();
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Thứ tư, 21 tháng 10: chưa có việc nào' }));
    expect(
      within(screen.getByRole('dialog', { name: 'Thứ tư, 21 tháng 10' })).getByText(
        'Ngày này chưa có việc nào.',
      ),
    ).toBeInTheDocument();
  });

  it("while Today loads, a quiet placeholder holds the strip's place; then the strip replaces it (F10.2)", async () => {
    let answer: () => void = () => undefined;
    mock.on(
      'GET /api/today',
      () => new Promise((resolve) => (answer = () => resolve({ body: VIEW }))),
    );
    const { container } = render(<TodayScreen />);
    const placeholder = container.querySelector('.today-strip-placeholder');
    // Same classes as the strip (so the same height), hidden from assistive technology, inert.
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder?.querySelectorAll('.today-strip__scroller .today-strip__cell')).toHaveLength(
      60,
    );
    expect(placeholder?.querySelectorAll('.today-strip__labels')).toHaveLength(60);
    expect(placeholder?.querySelector('.today-strip__legend')).not.toBeNull();
    expect(placeholder?.querySelectorAll('button, [tabindex]')).toHaveLength(0);
    expect(container.querySelector('.today__summary')).toHaveAttribute('aria-busy', 'true');
    act(() => answer());
    expect(await screen.findByRole('group', { name: 'Các ngày tới' })).toBeInTheDocument();
    expect(container.querySelector('.today-strip-placeholder')).toBeNull();
    expect(container.querySelectorAll('.today-strip')).toHaveLength(1);
  });

  it('after the sample card goes, the greeting takes focus; no ring after a mouse click', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/sample-data', { body: { offered: true, present: false } });
    mock.on('POST /api/sample-data', { status: 201, body: { created: [] } });
    const first = render(<TodayScreen />);
    await user.click(await screen.findByRole('button', { name: 'Tạo dữ liệu mẫu' }));
    const greeting = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(greeting).toHaveFocus());
    expect(greeting).toHaveAttribute('data-pointer-focus', 'true');
    act(() => greeting.blur());
    expect(greeting).not.toHaveAttribute('data-pointer-focus');
    first.unmount();

    // By keyboard the ring shows where focus went.
    localStorage.clear();
    render(<TodayScreen />);
    const yes = await screen.findByRole('button', { name: 'Tạo dữ liệu mẫu' });
    act(() => yes.focus());
    await user.keyboard('{Enter}');
    const heading = screen.getByRole('heading', { level: 1 });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).not.toHaveAttribute('data-pointer-focus');
  });

  it('a failed load says so and offers to try again', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/today', { status: 500, body: { error: { code: 'X', message: 'x' } } });
    const { container } = render(<TodayScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được việc hôm nay');
    expect(container.querySelector('.today-strip-placeholder')).toBeNull();
    mock.on('GET /api/today', { body: VIEW });
    await user.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(await screen.findByText(/Hôm nay còn 1 việc\./)).toBeInTheDocument();
  });
});
