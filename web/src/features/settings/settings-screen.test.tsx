import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { applyUiPrefsLive } from '../../lib/ui-prefs-live';
import { DEFAULT_UI_PREFS } from '../../lib/ui-prefs';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { normalizeReminderTime } from './reminders-settings-section';
import { startSettingsSync } from './settings-sync';
import { resetSettingsStore } from './settings-store';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
const puts = () => mock.callsTo('PUT /api/settings').map((call) => call.body);
const root = () => document.documentElement;

describe('Settings screen (F18.1)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSettingsStore();
    applyUiPrefsLive({ ...DEFAULT_UI_PREFS });
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows every section in order from GET /api/settings', async () => {
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    expect(await screen.findByRole('heading', { level: 2, name: 'Nhắc nhở' })).toBeVisible();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Giao diện',
      'Nhắc nhở',
      'Kho ghi chú',
      'Ứng dụng',
      'AI',
      'Kết nối Claude (MCP)',
    ]);
    expect(screen.getByText('D:\\SECONDBRAIN\\vault')).toBeVisible();
    expect(await screen.findByText('AI đang tắt. App không gửi gì đi.')).toBeVisible();
    expect(screen.getByLabelText('Giờ nhắc')).toHaveValue('08:00');
  });

  it('each appearance control sends only its field and applies at once, without a reload', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    await screen.findByRole('heading', { level: 2, name: 'Kho ghi chú' });

    await user.click(screen.getByRole('radio', { name: 'Sáng' }));
    expect(root().dataset.theme).toBe('light');
    await user.click(screen.getByRole('radio', { name: 'Hoa đào' }));
    expect(root().dataset.palette).toBe('hoa-dao');
    await user.click(screen.getByRole('radio', { name: '18 px' }));
    expect(root().dataset.fontSize).toBe('18');
    await waitFor(() => expect(puts()).toHaveLength(3));
    expect(puts()).toEqual([
      { ui: { theme: 'light' } },
      { ui: { palette: 'hoa-dao' } },
      { ui: { fontSize: 18 } },
    ]);
    expect(await screen.findAllByText('Đã lưu')).not.toHaveLength(0);

    const name = screen.getByRole('textbox', { name: 'Tên để chào' });
    await user.clear(name);
    await user.type(name, '  Khang Nhi ');
    expect(puts()).toHaveLength(3); // saved on Enter or blur, not per key
    await user.keyboard('{Enter}');
    await waitFor(() => expect(puts()).toHaveLength(4));
    expect(puts()[3]).toEqual({ ui: { name: 'Khang Nhi' } });
    expect(useUiPrefsStore.getState().prefs.name).toBe('Khang Nhi');

    await user.click(screen.getByRole('radio', { name: 'English' }));
    expect(i18n.language).toBe('en');
    expect(root().lang).toBe('en');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    // The radio she used keeps focus: Settings re-renders in place.
    expect(screen.getByRole('radio', { name: 'English' })).toHaveFocus();
    await waitFor(() => expect(puts()).toHaveLength(5));
    expect(puts()[4]).toEqual({ ui: { language: 'en' } });
  });

  it('a refused save says why and puts the screen back as it was', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('PUT /api/settings', {
      status: 500,
      body: { error: { code: 'WRITE_FAILED', message: 'x' } },
    });
    renderSettings();
    await screen.findByRole('heading', { level: 2, name: 'Kho ghi chú' });
    await user.click(screen.getByRole('radio', { name: 'Oải hương' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không lưu được cài đặt vào ổ đĩa. Kiểm tra ổ đĩa còn chỗ trống rồi thử lại.',
    );
    expect(root().dataset.palette).toBe('dau-tam');
    expect(screen.getByRole('radio', { name: 'Dâu tằm' })).toBeChecked();
  });

  it('an empty name is not sent; Escape puts the stored one back', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const name = await screen.findByRole('textbox', { name: 'Tên để chào' });
    await user.clear(name);
    await user.tab();
    expect(screen.getByRole('alert')).toHaveTextContent('Tên cần từ 1 đến 80 ký tự.');
    expect(puts()).toEqual([]);
    await user.click(name);
    await user.keyboard('{Escape}');
    expect(name).toHaveValue('khangnie');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('the reminder time is a 24-hour HH:mm field: "7:30" saves as 07:30, nonsense says why', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/reminders', {
      body: { available: true, time: '07:30', toastSupported: true, reminders: [] },
    });
    renderSettings();
    const time = await screen.findByRole('textbox', { name: 'Giờ nhắc' });
    expect(time).toHaveValue('08:00');
    await user.clear(time);
    await user.type(time, '25:00{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Giờ nhắc cần có dạng giờ:phút');
    expect(puts()).toEqual([]);
    await user.keyboard('{Escape}');
    expect(time).toHaveValue('08:00');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.clear(time);
    await user.type(time, '7:30{Enter}');
    await waitFor(() => expect(puts()).toEqual([{ reminders: { time: '07:30' } }]));
    expect(time).toHaveValue('07:30');
    expect(normalizeReminderTime(' 23:59 ')).toBe('23:59');
    expect(normalizeReminderTime('24:00')).toBeNull();
    expect(normalizeReminderTime('8h')).toBeNull();
  });

  it('applies UI settings changed in another window (settings:changed)', async () => {
    installSettingsRoutes(mock, settingsResponse());
    const stop = startSettingsSync();
    renderSettings();
    await screen.findByRole('heading', { level: 2, name: 'Kho ghi chú' });
    act(() =>
      emitServerEvent({
        type: 'settings:changed',
        ui: { ...DEFAULT_UI_PREFS, theme: 'light', name: 'Nhi', language: 'en' },
      }),
    );
    expect(root().dataset.theme).toBe('light');
    expect(useUiPrefsStore.getState().prefs.name).toBe('Nhi');
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Name for the greeting' })).toHaveValue('Nhi');
    stop();
  });

  it('the run-at-login switch saves at once; unsupported machines get a disabled switch', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Chạy khi đăng nhập Windows' });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(puts()).toEqual([{ system: { runAtLogin: true } }]));
    await waitFor(() => expect(toggle).toBeChecked());
  });

  it('run at login is off and explained where the machine has no Startup folder', async () => {
    installSettingsRoutes(
      mock,
      settingsResponse({
        system: { runAtLogin: false, runAtLoginSupported: false, platform: 'other' },
      }),
    );
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: 'Chạy khi đăng nhập Windows' });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAccessibleDescription('Tùy chọn này chỉ có trên Windows.');
  });

  it('a new port says a restart is needed and the installed app must be reinstalled', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const port = await screen.findByRole('textbox', { name: 'Cổng' });
    expect(screen.queryByText('Cần khởi động lại để dùng cổng mới.')).toBeNull();
    await user.clear(port);
    await user.type(port, '80{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Cổng cần là số từ 1024 đến 65535.');
    // Esc puts the saved port back and the error about the typed one goes with it.
    await user.keyboard('{Escape}');
    expect(port).toHaveValue('4747');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.clear(port);
    await user.type(port, '4800{Enter}');
    await waitFor(() => expect(puts()).toEqual([{ port: 4800 }]));
    expect(await screen.findByText('Cần khởi động lại để dùng cổng mới.')).toBeVisible();
    expect(
      screen.getByText(
        'Sau khi khởi động lại với cổng mới, hãy cài lại app (Cài đặt app) vì app đã cài vẫn mở cổng cũ.',
      ),
    ).toBeVisible();
    expect(screen.getByText('App đang chạy ở cổng 4747.')).toBeVisible();
  });

  it('API keys: masked "…last4" only, the field empties after saving, "Xóa khóa" removes it', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const key = await screen.findByLabelText('Khóa API Anthropic (Claude)');
    expect(key).toHaveAttribute('type', 'password');
    await user.type(key, 'sk-ant-1234567890abcd{Enter}');
    await waitFor(() =>
      expect(puts()).toEqual([
        { ai: { apiKey: { provider: 'anthropic', value: 'sk-ant-1234567890abcd' } } },
      ]),
    );
    expect(await screen.findByText('Đã lưu khóa …abcd.')).toBeVisible();
    expect(key).toHaveValue('');
    expect(document.body.textContent).not.toContain('sk-ant-1234567890abcd');
    await user.click(screen.getByRole('button', { name: 'Xóa khóa Anthropic (Claude)' }));
    await waitFor(() =>
      expect(puts()[1]).toEqual({ ai: { apiKey: { provider: 'anthropic', value: null } } }),
    );
    await waitFor(() => expect(screen.queryByText('Đã lưu khóa …abcd.')).toBeNull());
    // Both key fields (chat and, for OpenAI, search by meaning) are empty now.
    expect(screen.getAllByText(/Chưa có khóa nào/)).toHaveLength(2);
  });

  it('a key the server refuses is explained; models save trimmed; folders default without sources', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const scope = await screen.findByRole('group', { name: 'Thư mục AI được đọc' });
    // Root notes first, then the top folders.
    await waitFor(() => expect(within(scope).getAllByRole('checkbox')).toHaveLength(6));
    expect(within(scope).getByRole('checkbox', { name: 'Ghi chú ở gốc kho' })).toBeChecked();
    expect(within(scope).getByRole('checkbox', { name: '1 Projects' })).toBeChecked();
    expect(within(scope).getByRole('checkbox', { name: '3 Resources' })).not.toBeChecked();
    await user.click(within(scope).getByRole('checkbox', { name: '4 Archive' }));
    await waitFor(() =>
      expect(puts()).toEqual([
        { ai: { folders: ['', '0 Inbox', '1 Projects', '2 Areas', '4 Archive'] } },
      ]),
    );

    await user.type(
      screen.getByRole('textbox', { name: 'Mô hình trò chuyện' }),
      ' claude-x {Enter}',
    );
    await waitFor(() => expect(puts()[1]).toEqual({ ai: { chatModel: 'claude-x' } }));

    mock.on(
      'PUT /api/settings',
      apiError(400, 'VALIDATION', { field: 'ai.apiKey.value', reason: 'api-key-format' }),
    );
    await user.type(screen.getByLabelText('Khóa API Anthropic (Claude)'), 'short{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(/Khóa API cần từ 16 đến 512 ký tự/);
  });

  it('quitting asks first, then stops the server', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('POST /api/shutdown', { status: 202, body: { ok: true } });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Thoát Second Brain' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Thoát Second Brain?' });
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(mock.callsTo('POST /api/shutdown')).toHaveLength(0);
    const quit = screen.getByRole('button', { name: 'Thoát Second Brain' });
    // Cancelled from the keyboard: focus is back on the button, not on the page.
    quit.focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('alertdialog', { name: 'Thoát Second Brain?' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(quit).toHaveFocus();
    expect(quit).not.toHaveAttribute('aria-disabled');
    await user.click(quit);
    const again = await screen.findByRole('alertdialog', { name: 'Thoát Second Brain?' });
    await user.click(within(again).getByRole('button', { name: 'Thoát Second Brain' }));
    await waitFor(() => expect(mock.callsTo('POST /api/shutdown')).toHaveLength(1));
    expect(await screen.findByText(/Đã thoát Second Brain/)).toBeVisible();
  });
});
