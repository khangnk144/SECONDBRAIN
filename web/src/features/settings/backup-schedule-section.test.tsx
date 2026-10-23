import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { BackupScheduleStatus } from '../../lib/api/backup-schedule-api';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';
import { nextStatusCheckMs } from './use-backup-schedule';

let mock: FetchMock;
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();

function scheduleStatus(overrides: Partial<BackupScheduleStatus> = {}): BackupScheduleStatus {
  return {
    available: true,
    enabled: false,
    time: '21:00',
    keep: 14,
    folder: 'D:\\SECONDBRAIN\\Backups',
    isDefaultFolder: true,
    folderProblem: null,
    running: false,
    nextRunAt: null,
    lastSuccessAt: null,
    retryAt: null,
    lastRun: null,
    lastSuccess: null,
    runs: [],
    github: { enabled: false, configured: false, git: 'ok', pushing: false, lastPush: null },
    ...overrides,
  };
}

async function section() {
  return within(await screen.findByRole('group', { name: 'Sao lưu tự động' }));
}

describe('Settings: automatic backups (F27.1, F27.4, F27.5)', () => {
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('(F27.1) off by default with the default folder, 21:00 and 14; turning it on saves only that', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/backup/schedule', { body: scheduleStatus() });
    renderSettings();
    const box = await section();
    const toggle = box.getByRole('switch', { name: 'Sao lưu tự động hằng ngày' });
    expect(toggle).not.toBeChecked();
    expect(box.getByRole('textbox', { name: 'Thư mục sao lưu' })).toHaveAttribute(
      'placeholder',
      'D:\\SECONDBRAIN\\Backups',
    );
    expect(box.getByText('Để trống để dùng D:\\SECONDBRAIN\\Backups.')).toBeVisible();
    expect(box.getByRole('textbox', { name: 'Giờ sao lưu' })).toHaveValue('21:00');
    expect(box.getByRole('textbox', { name: 'Giữ lại bao nhiêu bản' })).toHaveValue('14');
    expect(box.getByText('Chưa có bản sao lưu tự động nào.')).toBeVisible();
    await user.click(toggle);
    await waitFor(() => expect(toggle).toBeChecked());
    expect(mock.callsTo('PUT /api/settings').map((c) => c.body)).toEqual([
      { backup: { schedule: { enabled: true } } },
    ]);
  });

  it('(F27.1) time and keep are checked before saving; the folder saves on Enter', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const box = await section();
    const keep = box.getByRole('textbox', { name: 'Giữ lại bao nhiêu bản' });
    await user.clear(keep);
    await user.type(keep, '100{Enter}');
    expect(await box.findByText('Nhập một số từ 3 đến 60.')).toBeVisible();
    const time = box.getByRole('textbox', { name: 'Giờ sao lưu' });
    await user.clear(time);
    await user.type(time, '7:30{Enter}');
    const folder = box.getByRole('textbox', { name: 'Thư mục sao lưu' });
    await user.type(folder, 'E:\\Sao lưu Đồ án{Enter}');
    await waitFor(() => expect(mock.callsTo('PUT /api/settings')).toHaveLength(2));
    expect(mock.callsTo('PUT /api/settings').map((c) => c.body)).toEqual([
      { backup: { schedule: { time: '07:30' } } },
      { backup: { schedule: { folder: 'E:\\Sao lưu Đồ án' } } },
    ]);
  });

  it('(F27.4) status lines, "Sao lưu ngay" and "Mở thư mục"', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    const last = {
      at: local(22, 21),
      kind: 'scheduled' as const,
      fileName: 'Second Brain vault 2026-10-22 2100.zip',
      bytes: 3_355_443,
      ok: true,
    };
    mock.on('GET /api/backup/schedule', {
      body: scheduleStatus({
        enabled: true,
        lastSuccess: last,
        lastRun: { ...last, at: local(23, 21), ok: false, error: 'disk-full', fileName: null },
        retryAt: local(23, 22),
      }),
    });
    mock.on('POST /api/backup/schedule/run', {
      body: {
        ok: true,
        run: { ...last, kind: 'manual', fileName: 'Second Brain vault 2026-10-24 0930.zip' },
      },
    });
    mock.on('POST /api/backup/schedule/open-folder', { status: 204 });
    renderSettings();
    const box = await section();
    expect(
      await box.findByText(
        'Lần cuối: 21:00 22/10/2026, 3,2 MB, Second Brain vault 2026-10-22 2100.zip',
      ),
    ).toBeVisible();
    expect(
      box.getByText(
        'Lỗi: ổ đĩa đã đầy. Dọn bớt chỗ hoặc chọn ổ khác. App sẽ thử lại lúc 22:00 23/10/2026.',
      ),
    ).toBeVisible();
    await user.click(box.getByRole('button', { name: 'Sao lưu ngay' }));
    expect(await box.findByText('Đã lưu Second Brain vault 2026-10-24 0930.zip.')).toBeVisible();
    await user.click(box.getByRole('button', { name: 'Mở thư mục' }));
    await waitFor(() =>
      expect(mock.callsTo('POST /api/backup/schedule/open-folder')).toHaveLength(1),
    );
  });

  it('(D3) an open Settings shows a scheduled run without a reload, and stops asking after', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 9, 23, 20, 6, 30) });
    try {
      installSettingsRoutes(mock, settingsResponse());
      mock.on('GET /api/backup/schedule', {
        body: scheduleStatus({ enabled: true, nextRunAt: local(23, 20, 7) }),
      });
      renderSettings();
      const box = await section();
      expect(await box.findByText('Lần tới: 20:07 23/10/2026')).toBeVisible();
      expect(box.getByText('Chưa có bản sao lưu tự động nào.')).toBeVisible();
      const asked = () => mock.callsTo('GET /api/backup/schedule').length;
      const before = asked();
      // 20:07: the run is due; the scheduler takes it at its next tick (here 20:07:20).
      await vi.advanceTimersByTimeAsync(33_000);
      expect(asked()).toBe(before + 1); // asked right after 20:07, still nothing new
      const run = {
        at: local(23, 20, 7),
        kind: 'scheduled' as const,
        fileName: 'Second Brain vault 2026-10-23 2007.zip',
        bytes: 1_048_576,
        ok: true,
      };
      mock.on('GET /api/backup/schedule', {
        body: scheduleStatus({
          enabled: true,
          nextRunAt: local(24, 20, 7),
          lastRun: run,
          lastSuccess: run,
          lastSuccessAt: run.at,
        }),
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(
        await box.findByText(
          'Lần cuối: 20:07 23/10/2026, 1 MB, Second Brain vault 2026-10-23 2007.zip',
        ),
      ).toBeVisible();
      expect(box.getByText('Lần tới: 20:07 24/10/2026')).toBeVisible();
      // The next run is a day away: no more polling meanwhile.
      const settled = asked();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(asked()).toBe(settled);
    } finally {
      vi.useRealTimers();
    }
  });

  it('(D3) when to ask again: just after the due time, every 10 s for 3 minutes, never while busy', () => {
    const at = (h: number, m: number, s = 0) => new Date(2026, 9, 23, h, m, s).getTime();
    const due = scheduleStatus({ enabled: true, nextRunAt: local(23, 20, 7) });
    expect(nextStatusCheckMs(due, at(20, 6))).toBe(62_000);
    expect(nextStatusCheckMs(due, at(20, 7, 30))).toBe(10_000);
    expect(nextStatusCheckMs(due, at(20, 11))).toBeNull();
    expect(nextStatusCheckMs({ ...due, running: true }, at(20, 7, 30))).toBeNull();
    expect(nextStatusCheckMs(scheduleStatus(), at(20, 7))).toBeNull();
    const retry = scheduleStatus({
      enabled: true,
      nextRunAt: local(24, 21),
      retryAt: local(23, 22),
    });
    expect(nextStatusCheckMs(retry, at(21, 59))).toBe(62_000);
  });

  it('a folder inside the vault is explained; a refused run says why in words', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/backup/schedule', {
      body: scheduleStatus({ folderProblem: 'inside-vault' }),
    });
    mock.on(
      'POST /api/backup/schedule/run',
      apiError(400, 'VALIDATION', { field: 'backup.schedule.folder', reason: 'inside-vault' }),
    );
    renderSettings();
    const box = await section();
    const notice =
      'Thư mục này nằm trong kho ghi chú nên không dùng được. Chọn thư mục bên ngoài kho.';
    expect(await box.findByText(notice)).toBeVisible();
    await user.click(box.getByRole('button', { name: 'Sao lưu ngay' }));
    expect(await box.findByRole('alert')).toHaveTextContent(notice);
  });

  it('(F27.5) GitHub: the switch waits for address and token; the token is masked and removable', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/backup/schedule', { body: scheduleStatus() });
    renderSettings();
    const github = within(await screen.findByRole('group', { name: 'Đẩy lên GitHub' }));
    const toggle = github.getByRole('switch', {
      name: 'Đẩy lên GitHub sau mỗi lần sao lưu tự động',
    });
    expect(toggle).toBeDisabled();
    expect(github.getByText('Điền địa chỉ kho và khóa truy cập trước để bật.')).toBeVisible();

    await user.type(
      github.getByRole('textbox', { name: 'Địa chỉ kho GitHub' }),
      'https://github.com/khangnie/kho.git{Enter}',
    );
    const token = github.getByLabelText('Khóa truy cập GitHub');
    expect(token).toHaveAttribute('type', 'password');
    await user.type(token, 'github_pat_SECRET00000000000000zzzz{Enter}');
    expect(await github.findByText('Đã lưu, kết thúc bằng …zzzz.')).toBeVisible();
    expect(token).toHaveValue('');
    await waitFor(() => expect(toggle).toBeEnabled());
    await user.click(github.getByRole('button', { name: 'Xóa khóa GitHub' }));
    await waitFor(() => expect(toggle).toBeDisabled());
    expect(mock.callsTo('PUT /api/settings').map((c) => c.body)).toEqual([
      { backup: { github: { remoteUrl: 'https://github.com/khangnie/kho.git' } } },
      { backup: { github: { token: 'github_pat_SECRET00000000000000zzzz' } } },
      { backup: { github: { token: null } } },
    ]);
    expect(document.body.textContent).not.toContain('github_pat_SECRET');
  });

  it('(F27.5) git missing disables the push with a hint; a refused push is said in plain words', async () => {
    const user = userEvent.setup();
    const settings = settingsResponse();
    settings.backup.github = {
      enabled: false,
      remoteUrl: 'https://github.com/khangnie/kho.git',
      branch: 'main',
      token: { set: true, last4: '…zzzz' },
    };
    installSettingsRoutes(mock, settings);
    let git: 'ok' | 'missing' = 'missing';
    mock.on('GET /api/backup/schedule', () => ({
      body: scheduleStatus({
        github: { enabled: false, configured: true, git, pushing: false, lastPush: null },
      }),
    }));
    mock.on('POST /api/backup/github/push', {
      body: { at: local(22, 12), ok: false, error: 'auth' },
    });
    renderSettings();
    const github = within(await screen.findByRole('group', { name: 'Đẩy lên GitHub' }));
    expect(
      await github.findByText('Cần Git để đẩy lên GitHub. Cài Git for Windows để bật.'),
    ).toBeVisible();
    expect(github.getByRole('switch')).toBeDisabled();

    git = 'ok';
    await user.type(
      github.getByRole('textbox', { name: 'Nhánh' }),
      '{Backspace}{Backspace}{Backspace}{Backspace}hoc-ky-1{Enter}',
    );
    await waitFor(() => expect(github.getByRole('switch')).toBeEnabled());
    await user.click(github.getByRole('button', { name: 'Đẩy ngay' }));
    expect(await github.findByRole('alert')).toHaveTextContent(
      'Chưa đẩy được: GitHub không nhận khóa truy cập. Kiểm tra khóa và quyền của nó với kho này.',
    );
  });

  it('has English texts', async () => {
    installSettingsRoutes(
      mock,
      settingsResponse({ ui: { ...settingsResponse().ui, language: 'en' } }),
    );
    mock.on('GET /api/backup/schedule', { body: scheduleStatus() });
    await i18n.changeLanguage('en');
    try {
      renderSettings();
      const box = within(await screen.findByRole('group', { name: 'Automatic backups' }));
      expect(box.getByRole('switch', { name: 'Back up automatically every day' })).toBeVisible();
      expect(box.getByRole('button', { name: 'Back up now' })).toBeVisible();
      expect(box.getByText('No automatic backup yet.')).toBeVisible();
    } finally {
      await i18n.changeLanguage('vi');
    }
  });
});
