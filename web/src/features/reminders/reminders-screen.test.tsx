import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarNav } from '../../app/sidebar-nav';
import { DialogHost } from '../dialogs/dialog-host';
import type { ReminderEntry } from '../../lib/api/reminders-types';
import { useTabsStore } from '../../lib/tabs-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { vaultStorage } from '../../lib/vault-storage';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { NOTIFICATION_HINT_KEY } from './notification-hint';
import { useNotificationPermission } from './notification-permission';
import {
  REMINDERS_REFRESH_DEBOUNCE_MS,
  resetReminders,
  startRemindersSync,
} from './reminders-store';
import { RemindersScreen } from './reminders-screen';
import { reminderEntry } from './reminders-test-fixtures';

let mock: FetchMock;
let listed: ReminderEntry[];

function renderScreen() {
  const router = createMemoryRouter(
    [
      {
        path: '/reminders',
        element: (
          <>
            <SidebarNav />
            <RemindersScreen />
            <DialogHost />
          </>
        ),
      },
      { path: '/settings', element: <p>settings route</p> },
    ],
    { initialEntries: ['/reminders'] },
  );
  return render(<RouterProvider router={router} />);
}

const PROJECT = reminderEntry({ due: '2026-10-24', threshold: 3 });
const TODAY = reminderEntry({
  path: '2 Areas/Giải tích.md',
  title: 'Nộp bài tập Giải tích',
  itemId: 'task:2 Areas/Giải tích.md#12',
  key: 'vault-a|task:2 Areas/Giải tích.md#12|2026-10-21|0',
  due: '2026-10-21',
  threshold: 0,
  missed: true,
  firedAt: new Date(2026, 9, 21, 9, 12).toISOString(),
});
const LATE = reminderEntry({
  path: '0 Inbox/Đăng ký học phần.md',
  title: 'Đăng ký học phần',
  key: 'vault-a|note:0 Inbox/Đăng ký học phần.md|2026-10-20|0',
  due: '2026-10-20',
  threshold: 0,
  firedAt: new Date(2026, 9, 20, 8, 0).toISOString(),
});

describe('reminders in the app (F17.3, F17.4)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetReminders();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 10, 0));
    listed = [PROJECT, TODAY, LATE];
    mock = installFetchMock();
    mock.on('GET /api/reminders', () => ({
      body: { available: true, time: '08:00', toastSupported: true, reminders: listed },
    }));
    mock.on('POST /api/reminders/dismiss', (call) => {
      const keys = (call.body as { keys: string[] }).keys;
      listed = listed.filter((entry) => !keys.includes(entry.key));
      return { body: { dismissed: keys.length } };
    });
    useNotificationPermission.setState({ permission: 'granted' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists each reminder with its due text, when it was sent, and the time setting', async () => {
    renderScreen();
    const list = await screen.findByRole('list', { name: 'Danh sách nhắc nhở' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'Đồ án Xác suấtCòn 3 ngàyĐã nhắc lúc 08:00Bỏ qua',
      'Nộp bài tập Giải tíchHôm nay đến hạnNhắc bù lúc 09:12Bỏ qua',
      'Đăng ký học phầnĐã quá hạnĐã nhắc lúc 08:00, 20/10Bỏ qua',
    ]);
    // Urgency is said in words and shown in the urgency text colour.
    expect(within(rows[0] as HTMLElement).getByText('Còn 3 ngày')).toHaveClass(
      'reminder-row__due--soon',
    );
    expect(within(rows[1] as HTMLElement).getByText('Hôm nay đến hạn')).toHaveClass(
      'reminder-row__due--urgent',
    );
    expect(screen.getByText('Mình nhắc bạn lúc 08:00.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Đổi giờ nhắc' })).toHaveAttribute('href', '/settings');
  });

  it('the title opens the note; "Bỏ qua" and "Bỏ qua tất cả" dismiss on the server', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Đồ án Xác suất' }));
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([PROJECT.path]);

    await user.click(
      screen.getByRole('button', { name: 'Bỏ qua nhắc nhở “Nộp bài tập Giải tích”' }),
    );
    expect(screen.queryByText('Nộp bài tập Giải tích')).toBeNull();
    expect(mock.callsTo('POST /api/reminders/dismiss')[0]?.body).toEqual({ keys: [TODAY.key] });

    // "Bỏ qua tất cả" asks first; cancelling keeps every row.
    await user.click(screen.getByRole('button', { name: 'Bỏ qua tất cả' }));
    let dialog = await screen.findByRole('dialog', { name: 'Bỏ qua cả 2 nhắc nhở?' });
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(mock.callsTo('POST /api/reminders/dismiss')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Bỏ qua tất cả' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Bỏ qua tất cả' }));
    dialog = await screen.findByRole('dialog', { name: 'Bỏ qua cả 2 nhắc nhở?' });
    await user.click(within(dialog).getByRole('button', { name: 'Bỏ qua tất cả' }));
    expect(mock.callsTo('POST /api/reminders/dismiss')[1]?.body).toEqual({
      keys: [PROJECT.key, LATE.key],
    });
    expect(
      await screen.findByText(
        'Chưa có nhắc nhở nào. Mình sẽ nhắc bạn trước hạn 3 ngày, 1 ngày và đúng ngày.',
      ),
    ).toBeVisible();
  });

  it('"Bỏ qua" by keyboard moves focus to the next row, then the heading once the list is empty', async () => {
    const user = userEvent.setup();
    renderScreen();
    const first = await screen.findByRole('button', { name: 'Bỏ qua nhắc nhở “Đồ án Xác suất”' });
    first.focus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: 'Bỏ qua nhắc nhở “Nộp bài tập Giải tích”' }),
    ).toHaveFocus();
    // The last row: focus goes to the row before it.
    screen.getByRole('button', { name: 'Bỏ qua nhắc nhở “Đăng ký học phần”' }).focus();
    await user.keyboard('{Enter}');
    expect(
      screen.getByRole('button', { name: 'Bỏ qua nhắc nhở “Nộp bài tập Giải tích”' }),
    ).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { level: 1, name: 'Nhắc nhở' })).toHaveFocus();
    expect(mock.callsTo('POST /api/reminders/dismiss')).toHaveLength(3);
  });

  it('before the server answered (offline start) no reminder time is shown, never a default', async () => {
    mock.on('GET /api/reminders', apiError(503, 'UNAVAILABLE'));
    renderScreen();
    expect(await screen.findByRole('alert')).toHaveTextContent('Chưa tải được nhắc nhở.');
    expect(screen.queryByText(/Mình nhắc bạn lúc/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Đổi giờ nhắc' })).toBeVisible();
  });

  it('a dismiss the server refuses puts the row back and says so', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/reminders/dismiss', apiError(503, 'UNAVAILABLE'));
    renderScreen();
    await user.click(
      await screen.findByRole('button', { name: 'Bỏ qua nhắc nhở “Đồ án Xác suất”' }),
    );
    expect(await screen.findByText('Đồ án Xác suất')).toBeVisible();
  });

  it('the sidebar badge counts the listed reminders and follows new ones', async () => {
    vi.useRealTimers();
    const stop = startRemindersSync();
    renderScreen();
    const link = await screen.findByRole('link', { name: 'Nhắc nhở, 3 nhắc nhở' });
    expect(link).toHaveAttribute('href', '/reminders');
    listed = [reminderEntry({ key: 'k-new', title: 'Thuyết trình' }), ...listed];
    emitServerEvent({ type: 'reminder', reminder: listed[0] as ReminderEntry });
    await waitFor(
      () => expect(screen.getByRole('link', { name: 'Nhắc nhở, 4 nhắc nhở' })).toBeVisible(),
      { timeout: REMINDERS_REFRESH_DEBOUNCE_MS * 10 },
    );
    expect(await screen.findByText('Thuyết trình')).toBeVisible();
    stop();
  });

  it('with notifications not allowed: no error, the list still shows it, a hint once per vault', async () => {
    const user = userEvent.setup();
    useNotificationPermission.setState({ permission: 'denied' });
    const first = renderScreen();
    expect(await screen.findByText('Đồ án Xác suất')).toBeVisible();
    const hint = screen.getByRole('note');
    expect(hint).toHaveTextContent(/Trình duyệt đang chặn thông báo của app/);
    await user.click(within(hint).getByRole('button', { name: 'Đã hiểu' }));
    expect(screen.queryByRole('note')).toBeNull();
    expect(vaultStorage.get(NOTIFICATION_HINT_KEY, false)).toBe(true);
    first.unmount();
    renderScreen();
    expect(await screen.findByText('Đồ án Xác suất')).toBeVisible();
    expect(screen.queryByRole('note')).toBeNull();
  });
});
