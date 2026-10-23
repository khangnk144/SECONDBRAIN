import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemInfo } from '../../lib/api/system-types';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';
import { resetSystemInfoStore } from './system-info-store';
import { trayLine } from './tray-row';

let mock: FetchMock;
let info: SystemInfo;
const LABEL = 'Biểu tượng khay và phím tắt toàn hệ thống';

function systemInfo(tray: Partial<SystemInfo['tray']> = {}): SystemInfo {
  return {
    runtime: 'exe',
    exePath: 'D:\\SECONDBRAIN\\Second Brain.exe',
    platform: 'windows',
    tray: { state: 'running', hotkey: 'Ctrl+Alt+Q', hotkeyRegistered: true, ...tray },
    shortcuts: { supported: true },
  };
}

describe('Settings: tray icon and global hotkey switch (F29.2, F29.3)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSystemInfoStore();
    mock = installFetchMock();
    info = systemInfo();
    mock.on('GET /api/system', () => ({ body: info }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('(F29.2) is a switch, on by default, saying the helper runs with Ctrl+Alt+Q', async () => {
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: LABEL });
    expect(toggle).toBeChecked();
    expect(
      await screen.findByText('Đang chạy. Bấm Ctrl+Alt+Q ở bất cứ đâu để ghi nhanh vào Inbox.'),
    ).toBeVisible();
  });

  it('(F29.2) turning it off saves system.tray and asks the server again', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const toggle = await screen.findByRole('switch', { name: LABEL });
    const before = mock.callsTo('GET /api/system').length;
    info = systemInfo({ state: 'off', hotkeyRegistered: null });
    await user.click(toggle);
    await waitFor(() => expect(toggle).not.toBeChecked());
    expect(mock.callsTo('PUT /api/settings').map((call) => call.body)).toEqual([
      { system: { tray: false } },
    ]);
    await waitFor(() => expect(mock.callsTo('GET /api/system').length).toBeGreaterThan(before));
    expect(
      await screen.findByText('Đang tắt. Bật lên để có biểu tượng khay và phím Ctrl+Alt+Q.'),
    ).toBeVisible();
  });

  it('(F29.3) says when another app holds Ctrl+Alt+Q; the tray still works', async () => {
    info = systemInfo({ hotkeyRegistered: false });
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const notice = await screen.findByText(
      'Phím tắt Ctrl+Alt+Q đang được ứng dụng khác dùng. Biểu tượng khay vẫn chạy: bấm chuột phải vào nó rồi chọn Ghi nhanh.',
    );
    expect(notice).toHaveClass('settings-field__notice');
    expect(screen.getByRole('switch', { name: LABEL })).toBeChecked();
  });

  it('is not offered off Windows', async () => {
    installSettingsRoutes(
      mock,
      settingsResponse({
        system: { runAtLogin: false, runAtLoginSupported: false, platform: 'other', tray: true },
      }),
    );
    renderSettings();
    await screen.findByRole('switch', { name: 'Chạy khi đăng nhập Windows' });
    expect(screen.queryByRole('switch', { name: LABEL })).toBeNull();
  });

  it('reads in English too', async () => {
    const { i18n } = await import('../../i18n');
    await i18n.changeLanguage('en');
    info = systemInfo({ state: 'failed', hotkeyRegistered: null });
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    expect(
      await screen.findByRole('switch', { name: 'Tray icon and system-wide shortcut' }),
    ).toBeChecked();
    expect(
      await screen.findByText(
        'The tray icon stopped several times, so the app paused restarting it. Turn this switch off and on to try again.',
      ),
    ).toBeVisible();
  });
});

describe('trayLine', () => {
  it('maps the stored switch and the helper state to one sentence', () => {
    const tray = systemInfo().tray;
    expect(trayLine(false, tray)).toBe('off');
    expect(trayLine(true, undefined)).toBe('starting');
    expect(trayLine(true, { ...tray, state: 'off' })).toBe('starting');
    expect(trayLine(true, { ...tray, hotkeyRegistered: null })).toBe('starting');
    expect(trayLine(true, tray)).toBe('running');
    expect(trayLine(true, { ...tray, hotkeyRegistered: false })).toBe('hotkeyTaken');
    expect(trayLine(true, { ...tray, state: 'failed' })).toBe('failed');
  });
});
