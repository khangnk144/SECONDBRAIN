import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from './app-navigation';
import { captureToInbox, MAX_CAPTURE_LENGTH } from './capture-flow';
import { dailyPath, openDailyNote } from './daily-flow';
import { useTabsStore } from './tabs-store';
import { apiError, installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { TOAST_MS, useToastStore } from './toast-store';
import { useTreeStore } from './tree-store';

const toasts = () => useToastStore.getState().toasts;
const enc = encodeURIComponent;

describe('quick capture flow (F12.1, F12.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('saves to the Inbox, refreshes the tree and offers "Mở" in a 4 s toast', async () => {
    const refresh = vi.spyOn(useTreeStore.getState(), 'scheduleRefresh');
    mock.on('POST /api/capture', {
      status: 201,
      body: { path: '0 Inbox/Gọi mẹ lúc 8 giờ.md', revision: 'r' },
    });
    await expect(captureToInbox('Gọi mẹ lúc 8 giờ\n')).resolves.toBe('0 Inbox/Gọi mẹ lúc 8 giờ.md');
    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'Gọi mẹ lúc 8 giờ\n' });
    expect(refresh).toHaveBeenCalled();
    const toast = toasts()[0];
    expect(toast).toMatchObject({ message: 'Đã lưu vào Inbox.', durationMs: TOAST_MS });
    expect(toast?.action?.label).toBe('Mở');
    await toast?.action?.run();
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      '0 Inbox/Gọi mẹ lúc 8 giờ.md',
    ]);
  });

  it('sends nothing for blank text or text over the limit, and reports failures', async () => {
    await expect(captureToInbox('  \n ')).resolves.toBeNull();
    await expect(captureToInbox('a'.repeat(MAX_CAPTURE_LENGTH + 1))).resolves.toBeNull();
    expect(mock.calls).toEqual([]);
    expect(toasts()[0]).toMatchObject({ tone: 'error' });
    mock.on('POST /api/capture', apiError(500, 'WRITE_FAILED'));
    await expect(captureToInbox('x')).resolves.toBeNull();
    expect(toasts().at(-1)?.message).toMatch(/Không ghi được file/);
  });
});

describe('daily note flow (F13.1)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 8, 30));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens an existing daily note without creating anything', async () => {
    mock.on('GET /api/daily', { body: { path: 'Daily/2026-10-19.md', revision: 'r' } });
    await expect(openDailyNote()).resolves.toBe('Daily/2026-10-19.md');
    expect(mock.callsTo('GET /api/daily')[0]?.query.get('date')).toBe('2026-10-19');
    expect(mock.callsTo('POST /api/daily')).toHaveLength(0);
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${enc('Daily/2026-10-19.md')}`,
      undefined,
    );
  });

  it('GET 404 → one POST, then opens with the caret at the template cursor', async () => {
    mock.on('GET /api/daily', apiError(404, 'NOT_FOUND'));
    mock.on('POST /api/daily', {
      status: 201,
      body: { path: 'Daily/2026-10-19.md', revision: 'r', cursor: 57 },
    });
    // Two quick presses of Alt+T still make one request each way.
    const [a, b] = await Promise.all([openDailyNote(), openDailyNote()]);
    expect([a, b]).toEqual(['Daily/2026-10-19.md', 'Daily/2026-10-19.md']);
    expect(mock.callsTo('GET /api/daily')).toHaveLength(1);
    expect(mock.callsTo('POST /api/daily')).toHaveLength(1);
    expect(mock.callsTo('POST /api/daily')[0]?.body).toEqual({ date: '2026-10-19' });
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${enc('Daily/2026-10-19.md')}&cursor=57`,
      undefined,
    );
  });

  it('409 EXISTS (another window was first) opens the existing note; other errors toast', async () => {
    mock.on('GET /api/daily', apiError(404, 'NOT_FOUND'));
    mock.on('POST /api/daily', apiError(409, 'EXISTS', { path: 'Daily/2026-10-21.md' }));
    await expect(openDailyNote('2026-10-21', { newTab: true })).resolves.toBe(
      'Daily/2026-10-21.md',
    );
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['Daily/2026-10-21.md']);

    mock.on('GET /api/daily', apiError(500, 'INTERNAL'));
    await expect(openDailyNote('2026-10-22')).resolves.toBeNull();
    expect(toasts().at(-1)).toMatchObject({ tone: 'error' });
    expect(dailyPath('2026-10-22')).toBe('Daily/2026-10-22.md');
  });
});
