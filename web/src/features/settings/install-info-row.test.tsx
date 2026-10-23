import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemInfo } from '../../lib/api/system-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';
import { resetSystemInfoStore } from './system-info-store';

let mock: FetchMock;
const EXE = 'D:\\SECONDBRAIN Đồ án\\Second Brain.exe';
const RECREATE = 'Tạo lại lối tắt trên màn hình';

function systemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
  return {
    runtime: 'exe',
    exePath: EXE,
    platform: 'windows',
    tray: { state: 'running', hotkey: 'Ctrl+Alt+Q', hotkeyRegistered: true },
    shortcuts: { supported: true },
    ...overrides,
  };
}

describe('Settings: how the app runs (F29.4, F29.5)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSystemInfoStore();
    mock = installFetchMock();
    installSettingsRoutes(mock, settingsResponse());
  });
  afterEach(() => vi.unstubAllGlobals());

  it('(F29.4) names the .exe and its path; "Tạo lại lối tắt" recreates the shortcuts', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/system', { body: systemInfo() });
    mock.on('POST /api/system/shortcuts', { status: 204 });
    renderSettings();
    expect(await screen.findByText('Đang chạy bằng ứng dụng .exe')).toBeVisible();
    expect(screen.getByText(`Tệp: ${EXE}`)).toBeVisible();
    await user.click(screen.getByRole('button', { name: RECREATE }));
    expect(
      await screen.findByText('Đã tạo lại lối tắt trên màn hình và trong menu Start.'),
    ).toBeVisible();
    expect(mock.callsTo('POST /api/system/shortcuts')).toHaveLength(1);
  });

  it('(F29.4) says what happened when Windows refused the shortcuts', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/system', { body: systemInfo() });
    mock.on(
      'POST /api/system/shortcuts',
      apiError(500, 'WRITE_FAILED', { reason: 'shortcut-failed' }),
    );
    renderSettings();
    await user.click(await screen.findByRole('button', { name: RECREATE }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Windows chưa cho tạo lối tắt. Bạn thử lại, hoặc tạo lối tắt bằng tay từ tệp .exe.',
    );
  });

  it('(F29.4, F29.5) from source on Windows: how to make the .exe and the SmartScreen step', async () => {
    mock.on('GET /api/system', {
      body: systemInfo({ runtime: 'source', exePath: null, shortcuts: { supported: false } }),
    });
    renderSettings();
    expect(await screen.findByText('Đang chạy từ mã nguồn')).toBeVisible();
    expect(screen.getByText(/bấm đúp "Tạo bản exe" trong thư mục app\\launcher/)).toBeVisible();
    expect(screen.getByText(/"Thông tin bổ sung" rồi "Vẫn chạy"/)).toBeVisible();
    expect(screen.queryByRole('button', { name: RECREATE })).toBeNull();
  });

  it('shows nothing until the server answered, and no Windows hints elsewhere', async () => {
    let answer: () => void = () => undefined;
    mock.on(
      'GET /api/system',
      () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              body: systemInfo({
                runtime: 'source',
                exePath: null,
                platform: 'other',
                shortcuts: { supported: false },
              }),
            });
        }),
    );
    renderSettings();
    await screen.findByRole('button', { name: 'Thoát Second Brain' });
    expect(screen.queryByText('Đang chạy từ mã nguồn')).toBeNull();
    await waitFor(() => expect(mock.callsTo('GET /api/system').length).toBeGreaterThan(0));
    answer();
    expect(await screen.findByText('Đang chạy từ mã nguồn')).toBeVisible();
    expect(screen.queryByText(/Tạo bản exe/)).toBeNull();
  });
});
