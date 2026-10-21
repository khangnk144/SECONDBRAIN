import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../testing/reset-app-state';
import { useToastStore } from '../toast-store';
import { exportBackupFromCommand } from './settings-command-actions';

const ZIP_NAME = 'second-brain-sao-luu-2026-10-21-0930.zip';
const messages = () => useToastStore.getState().toasts.map((toast) => toast.message);

describe('palette "Xuất bản sao lưu": one toast while it works, then only the outcome', () => {
  let answer: () => Response;
  let release: () => void;

  beforeEach(async () => {
    await resetAppState();
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => undefined }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.stubGlobal('fetch', async () => {
      await gate;
      return answer();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('replaces "Đang chuẩn bị bản sao lưu…" with the download message', async () => {
    answer = () =>
      new Response('PK', {
        status: 200,
        headers: { 'content-disposition': `attachment; filename="${ZIP_NAME}"` },
      });
    const done = exportBackupFromCommand();
    expect(messages()).toEqual(['Đang chuẩn bị bản sao lưu…']);
    release();
    await done;
    expect(messages()).toEqual([`Đã tải bản sao lưu về máy: ${ZIP_NAME}.`]);
  });

  it('a vault too large for one zip says so (not the restore wording), alone', async () => {
    answer = () =>
      new Response(
        JSON.stringify({
          error: { code: 'VALIDATION', message: 'x', details: { reason: 'too-large' } },
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    const done = exportBackupFromCommand();
    release();
    await done;
    expect(messages()).toEqual([
      'Kho quá lớn để xuất thành một tệp zip (trên 4 GB hoặc 65.000 tệp).',
    ]);
    expect(useToastStore.getState().toasts[0]?.tone).toBe('error');
  });
});
