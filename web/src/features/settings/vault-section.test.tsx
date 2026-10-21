import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { fileNameFromDisposition } from '../../lib/api/backup-api';
import { restoreFormProblem } from './backup-restore-form';
import { resetSettingsStore } from './settings-store';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';
import { useToastStore } from '../../lib/toast-store';
import { showVaultOpenedNotice } from './vault-opened-notice';
import { setPageReload } from './vault-reload';

let mock: FetchMock;
let reload: ReturnType<typeof vi.fn<() => void>>;
let downloads: { name: string; href: string }[];
let sent: { url: string; init: RequestInit | undefined }[];

const ZIP_NAME = 'second-brain-sao-luu-2026-10-21-0930.zip';

/** The zip download and the multipart restore are not JSON: answered before the route table. */
function installBinaryRoutes(options: { unreadable?: number } = {}) {
  const jsonFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, init });
    if (url === '/api/backup/export') {
      return new Response('PK', {
        status: 200,
        headers: {
          'content-disposition': `attachment; filename="${ZIP_NAME}"; filename*=UTF-8''${ZIP_NAME}`,
          'x-sb-backup-unreadable': String(options.unreadable ?? 0),
        },
      });
    }
    if (url === '/api/backup/restore') {
      return new Response(JSON.stringify({ path: 'D:\\Khôi phục\\Kho thử', vaultId: 'vault-a' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return jsonFetch(input, init);
  });
}

describe('Settings: vault, index and backups (F18.3, F18.4, F18.5)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSettingsStore();
    mock = installFetchMock();
    installSettingsRoutes(mock, settingsResponse());
    reload = vi.fn<() => void>();
    setPageReload(reload);
    sessionStorage.clear();
    downloads = [];
    sent = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: () => 'blob:sao-luu',
        revokeObjectURL: () => undefined,
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push({ name: this.download, href: this.href });
    });
  });
  afterEach(() => {
    setPageReload(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('switching to a folder the server refuses says why and keeps this vault (no reload)', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/vault/switch', apiError(400, 'VAULT_UNUSABLE', { reason: 'not-found' }));
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Mở thư mục khác…' }));
    const field = screen.getByRole('textbox', { name: 'Đường dẫn thư mục' });
    expect(field).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Mở' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập đường dẫn thư mục bạn muốn mở nhé.');
    await user.type(field, 'D:\\Không có\\Kho');
    await user.click(screen.getByRole('button', { name: 'Mở' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Không tìm thấy thư mục này. Kiểm tra lại đường dẫn nhé.',
    );
    expect(mock.callsTo('POST /api/vault/switch')[0]?.body).toEqual({ path: 'D:\\Không có\\Kho' });
    expect(reload).not.toHaveBeenCalled();
    // Nothing to confirm on the next start.
    showVaultOpenedNotice();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('a switch that worked reloads the page into the other vault', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/vault/switch', { body: { vaultId: 'vault-b', path: 'D:\\Kho B' } });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Mở thư mục khác…' }));
    await user.type(screen.getByRole('textbox', { name: 'Đường dẫn thư mục' }), 'D:\\Kho B{Enter}');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // The reloaded page says the other vault is open, once.
    showVaultOpenedNotice();
    showVaultOpenedNotice();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Đã mở kho ở D:\\Kho B.',
    ]);
  });

  it('"Xây lại chỉ mục" shows the progress of the rebuild, then that it is done', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/index/rebuild', { status: 202, body: { started: true } });
    renderSettings();
    const button = await screen.findByRole('button', { name: 'Xây lại chỉ mục' });
    await user.click(button);
    expect(button).toBeDisabled();
    act(() => emitServerEvent({ type: 'index:progress', phase: 'index', done: 120, total: 480 }));
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ xây lại chỉ mục' });
    expect(bar).toHaveAttribute('value', '120');
    expect(bar).toHaveAttribute('max', '480');
    expect(screen.getByText('Đang xây lại chỉ mục: 120/480 tệp.')).toBeVisible();
    act(() => emitServerEvent({ type: 'index:progress', phase: 'done', done: 480, total: 480 }));
    expect(screen.getByText('Đã xây lại chỉ mục.')).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(button).toBeEnabled();
  });

  it('"Xuất bản sao lưu…" downloads the zip blob under the server\'s name', async () => {
    const user = userEvent.setup();
    installBinaryRoutes({ unreadable: 2 });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Xuất bản sao lưu…' }));
    await waitFor(() => expect(downloads).toEqual([{ name: ZIP_NAME, href: 'blob:sao-luu' }]));
    expect(sent.find((call) => call.url === '/api/backup/export')?.init?.method).toBe('POST');
    expect(
      await screen.findByText(
        `Đã tải bản sao lưu về máy: ${ZIP_NAME}. 2 tệp không đọc được nên không có trong bản sao lưu.`,
      ),
    ).toBeVisible();
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''sao%20l%C6%B0u.zip")).toBe(
      'sao lưu.zip',
    );
  });

  it('a vault too large to export says so', async () => {
    const user = userEvent.setup();
    const jsonFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input) === '/api/backup/export'
        ? new Response(
            JSON.stringify({
              error: { code: 'VALIDATION', message: 'x', details: { reason: 'too-large' } },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        : jsonFetch(input, init),
    );
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Xuất bản sao lưu…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Kho quá lớn để xuất/);
    expect(downloads).toEqual([]);
  });

  it('"Khôi phục thử…" checks the form, sends the fields before the file, then reloads', async () => {
    const user = userEvent.setup();
    installBinaryRoutes();
    renderSettings();
    expect(restoreFormProblem(null, 'D:\\x')).toBe('no-file');
    expect(restoreFormProblem(new File(['x'], 'sao-luu.rar'), 'D:\\x')).toBe('not-zip');
    expect(restoreFormProblem(new File(['x'], 'Sao lưu.ZIP'), '  ')).toBe('no-target');

    await user.click(await screen.findByRole('button', { name: 'Khôi phục thử…' }));
    // The app's own button opens the picker; the chosen name is shown in words.
    const choose = screen.getByRole('button', { name: 'Chọn tệp sao lưu…' });
    expect(choose).toHaveFocus();
    expect(choose).toHaveAccessibleDescription('Chưa chọn tệp nào.');
    const input = screen.getByLabelText('Tệp sao lưu (.zip)');
    const picked = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    await user.click(choose);
    expect(picked).toHaveBeenCalledTimes(1);
    expect(input).toHaveAttribute('tabindex', '-1');
    const submit = screen.getByRole('button', { name: 'Khôi phục và mở' });
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('Chọn tệp sao lưu (.zip) trước nhé.');
    const zip = new File(['PK'], 'Sao lưu học kỳ 1.zip', { type: 'application/zip' });
    picked.mockRestore();
    await user.upload(input, zip);
    expect(screen.getByRole('button', { name: 'Chọn tệp khác…' })).toHaveAccessibleDescription(
      'Sao lưu học kỳ 1.zip',
    );
    await user.click(submit);
    expect(screen.getByRole('alert')).toHaveTextContent('Nhập thư mục để khôi phục vào nhé.');
    await user.type(
      screen.getByRole('textbox', { name: 'Thư mục để khôi phục vào' }),
      'D:\\Khôi phục\\Kho thử',
    );
    await user.click(submit);
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    const form = sent.find((call) => call.url === '/api/backup/restore')?.init?.body as FormData;
    expect([...form.keys()]).toEqual(['target', 'open', 'file']);
    expect(form.get('target')).toBe('D:\\Khôi phục\\Kho thử');
    expect(form.get('open')).toBe('true');
    expect((form.get('file') as File).name).toBe('Sao lưu học kỳ 1.zip');
    showVaultOpenedNotice();
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Đã khôi phục và mở kho ở D:\\Khôi phục\\Kho thử.',
    ]);
  });

  it('templates: says how many came back; logs: opens the folder', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/templates/restore', {
      body: { restored: ['Templates/Đồ án.md', 'Templates/Daily.md'] },
    });
    mock.on('POST /api/logs/reveal', { status: 204 });
    renderSettings();
    await user.click(await screen.findByRole('button', { name: 'Khôi phục mẫu gốc' }));
    expect(await screen.findByText('Đã tạo lại 2 mẫu.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Mở thư mục log' }));
    expect(await screen.findByText('Đã mở thư mục log trong File Explorer.')).toBeVisible();
    expect(mock.callsTo('POST /api/logs/reveal')).toHaveLength(1);
  });

  it('"Xóa dữ liệu mẫu" is not offered while there is no sample data', async () => {
    renderSettings();
    await screen.findByRole('button', { name: 'Khôi phục mẫu gốc' });
    expect(screen.queryByRole('button', { name: 'Xóa dữ liệu mẫu' })).toBeNull();
  });

  it('deletes the sample data after the confirm and says which edited files stayed', async () => {
    const user = userEvent.setup();
    mock.on('GET /api/sample-data', { body: { offered: false, present: true } });
    mock.on('DELETE /api/sample-data', {
      body: {
        removed: ['1 Projects/Đồ án mẫu.md', '0 Inbox/Ý tưởng.md'],
        kept: ['2 Areas/Ghi chú.md'],
        trashId: 't',
        journalId: 'j',
      },
    });
    renderSettings();
    const trigger = await screen.findByRole('button', { name: 'Xóa dữ liệu mẫu' });
    // Cancel by keyboard: nothing deleted, focus back on the button.
    trigger.focus();
    await user.keyboard('{Enter}');
    let dialog = await screen.findByRole('alertdialog', { name: 'Xóa dữ liệu mẫu?' });
    await user.click(within(dialog).getByRole('button', { name: 'Hủy' }));
    expect(trigger).toHaveFocus();
    expect(mock.callsTo('DELETE /api/sample-data')).toHaveLength(0);
    await user.keyboard('{Enter}');
    dialog = await screen.findByRole('alertdialog', { name: 'Xóa dữ liệu mẫu?' });
    await user.click(within(dialog).getByRole('button', { name: 'Xóa dữ liệu mẫu' }));
    expect(
      await screen.findByText(
        'Đã chuyển 2 tệp mẫu vào thùng rác. Giữ lại 1 tệp vì bạn đã sửa: Ghi chú.',
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Xóa dữ liệu mẫu' })).toBeNull();
    expect(mock.callsTo('DELETE /api/sample-data')).toHaveLength(1);
  });
});
