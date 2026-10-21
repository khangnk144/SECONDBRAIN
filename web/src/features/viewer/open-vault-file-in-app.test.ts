import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { setApiToken } from '../../lib/api';
import { fileRoute, noteRoute, type Navigator } from '../../lib/app-navigation';
import { openVaultFile } from '../../lib/open-vault-file';
import { useTabsStore } from '../../lib/tabs-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { startOpenVaultFile } from './open-vault-file-in-app';

const PAGE = '1 Projects/Trang web.html';
const IMAGE = 'Attachments/2026-10/sơ đồ.png';

const toasts = () => useToastStore.getState().toasts;
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('openVaultFile (F15.3)', () => {
  let navigate: Mock<Navigator>;
  let mock: FetchMock;
  let clicks: { href: string; download: string }[];
  let stop: () => void;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    setApiToken('tok-1');
    mock = installFetchMock();
    mock.on('GET /api/files', { body: { bytes: 'x' } });
    mock.on('POST /api/files/open-external', { status: 204 });
    clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push({ href: this.href, download: this.download });
    });
    URL.createObjectURL = vi.fn(() => 'blob:test/1');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(window, 'open');
    stop = startOpenVaultFile();
  });
  afterEach(() => {
    stop();
    setApiToken(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens notes as note tabs and PDFs as viewer tabs', () => {
    openVaultFile('3 Resources/other/Bài đọc.md');
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('3 Resources/other/Bài đọc.md'), undefined);
    openVaultFile('3 Resources/papers/bài giảng 3.pdf', { newTab: true });
    expect(navigate).toHaveBeenLastCalledWith(
      fileRoute('3 Resources/papers/bài giảng 3.pdf'),
      undefined,
    );
    const tabs = useTabsStore.getState().tabs;
    expect(tabs.map((tab) => [tab.kind, tab.path])).toEqual([
      ['note', '3 Resources/other/Bài đọc.md'],
      ['file', '3 Resources/papers/bài giảng 3.pdf'],
    ]);
    expect(mock.calls).toHaveLength(0);
  });

  it('downloads HTML and images with the token header and download=1, never navigating', async () => {
    openVaultFile(PAGE);
    await flush();
    openVaultFile(IMAGE);
    await flush();
    const calls = mock.callsTo('GET /api/files');
    expect(calls.map((call) => call.query.get('path'))).toEqual([PAGE, IMAGE]);
    expect(calls.every((call) => call.query.get('download') === '1')).toBe(true);
    expect(calls.every((call) => !call.url.includes('tok-1'))).toBe(true);
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)['X-SB-Token']).toBe('tok-1');
    expect(clicks).toEqual([
      { href: 'blob:test/1', download: 'Trang web.html' },
      { href: 'blob:test/1', download: 'sơ đồ.png' },
    ]);
    expect(navigate).not.toHaveBeenCalled();
    expect(window.open).not.toHaveBeenCalled();
    expect(document.querySelector('iframe')).toBeNull();
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(toasts()[0]?.message).toBe('Đã tải Trang web.html về máy.');
  });

  it('offers "Mở bằng ứng dụng khác" on the download toast', async () => {
    openVaultFile(PAGE);
    await flush();
    const action = toasts()[0]?.action;
    expect(action?.label).toBe('Mở bằng ứng dụng khác');
    await act(async () => {
      await action?.run();
    });
    expect(mock.callsTo('POST /api/files/open-external')[0]?.body).toEqual({ path: PAGE });
    expect(toasts().at(-1)?.message).toBe('Đang mở Trang web.html bằng ứng dụng mặc định của máy.');
  });

  it('says what happened when the file is gone or is a program', async () => {
    mock.on('GET /api/files', apiError(404, 'NOT_FOUND'));
    openVaultFile(PAGE);
    await flush();
    expect(toasts()[0]).toMatchObject({
      tone: 'error',
      message:
        'Không tìm thấy tệp Trang web.html. Có thể nó đã được đổi tên hoặc chuyển vào thùng rác.',
    });
    expect(clicks).toEqual([]);

    mock.on('POST /api/files/open-external', apiError(400, 'VALIDATION', { reason: 'executable' }));
    const { openWithOtherApp } = await import('./vault-file-actions');
    await act(async () => {
      await openWithOtherApp('3 Resources/other/cài đặt.bat');
    });
    expect(toasts().at(-1)?.message).toContain('không tự mở chương trình hay tập lệnh');
  });
});
