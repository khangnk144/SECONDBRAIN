import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { Navigator } from '../../lib/app-navigation';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { LIVE_QUERY_DEBOUNCE_MS } from '../../lib/use-live-query';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { DailyNavRow } from './daily-nav-row';
import { dailyDateFromPath } from './daily-note-date';

const noteRoute = (path: string, extra = '') => `/note?path=${encodeURIComponent(path)}${extra}`;

describe('daily note navigation (F13.3)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  let neighbors: { previous: string | null; next: string | null };

  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    neighbors = { previous: 'Daily/2026-10-12.md', next: 'Daily/2026-10-25.md' };
    mock = installFetchMock();
    mock.on('GET /api/daily/neighbors', () => ({ body: neighbors }));
    mock.on('GET /api/daily', apiError(404, 'NOT_FOUND'));
    mock.on('POST /api/daily', (call) => {
      const { date } = call.body as { date: string };
      return { status: 201, body: { path: `Daily/${date}.md`, revision: 'r1', cursor: 42 } };
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows only on daily notes (any case), never on other notes or impossible dates', () => {
    expect(dailyDateFromPath('Daily/2026-10-19.md')).toBe('2026-10-19');
    expect(dailyDateFromPath('daily/2026-10-19.MD')).toBe('2026-10-19');
    expect(dailyDateFromPath('Daily/2026-02-30.md')).toBeNull();
    expect(dailyDateFromPath('1 Projects/2026-10-19.md')).toBeNull();
    expect(dailyDateFromPath('Daily/sub/2026-10-19.md')).toBeNull();
    const { container } = render(<DailyNavRow path="0 Inbox/Ý tưởng.md" />);
    expect(container).toBeEmptyDOMElement();
    expect(mock.calls).toHaveLength(0);
  });

  it('shows the long date and asks for the neighbours of that day', async () => {
    render(<DailyNavRow path="Daily/2026-10-19.md" />);
    const nav = screen.getByRole('navigation', { name: 'Chuyển giữa các ghi chú hằng ngày' });
    expect(within(nav).getByText('Thứ hai, 19/10/2026')).toHaveAttribute('datetime', '2026-10-19');
    await waitFor(() => expect(mock.callsTo('GET /api/daily/neighbors')).toHaveLength(1));
    expect(mock.callsTo('GET /api/daily/neighbors')[0]?.query.get('date')).toBe('2026-10-19');
  });

  it('opens the nearest existing daily note in each direction, skipping gaps', async () => {
    const user = userEvent.setup();
    render(<DailyNavRow path="Daily/2026-10-19.md" />);
    const previous = screen.getByRole('button', { name: 'Ngày trước' });
    await waitFor(() => expect(previous).toHaveAttribute('title', 'Mở ghi chú ngày 12/10/2026'));
    await user.click(previous);
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('Daily/2026-10-12.md'), undefined);
    // Keyboard: real buttons, Tab then Enter.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Ngày sau' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenLastCalledWith(noteRoute('Daily/2026-10-25.md'), undefined);
    expect(mock.callsTo('POST /api/daily')).toHaveLength(0);
  });

  it('offers to create the adjacent day at both ends, then opens it at the caret', async () => {
    neighbors = { previous: null, next: null };
    const user = userEvent.setup();
    render(<DailyNavRow path="Daily/2026-10-01.md" />);
    const before = await screen.findByRole('button', { name: 'Tạo ngày 30/09' });
    const after = screen.getByRole('button', { name: 'Tạo ngày 02/10' });
    expect(before).toHaveAttribute('title', 'Chưa có ghi chú ngày 30/09/2026. Bấm để tạo.');
    await user.click(before);
    await waitFor(() => expect(mock.callsTo('POST /api/daily')).toHaveLength(1));
    expect(mock.callsTo('POST /api/daily')[0]?.body).toEqual({ date: '2026-09-30' });
    expect(navigate).toHaveBeenLastCalledWith(
      noteRoute('Daily/2026-09-30.md', '&cursor=42'),
      undefined,
    );
    await user.click(after);
    await waitFor(() => expect(mock.callsTo('POST /api/daily')).toHaveLength(2));
    expect(mock.callsTo('POST /api/daily')[1]?.body).toEqual({ date: '2026-10-02' });
  });

  it('follows the vault: a day created elsewhere turns "Tạo" into "Ngày sau"', async () => {
    neighbors = { previous: 'Daily/2026-10-18.md', next: null };
    render(<DailyNavRow path="Daily/2026-10-19.md" />);
    await screen.findByRole('button', { name: 'Tạo ngày 20/10' });
    neighbors = { previous: 'Daily/2026-10-18.md', next: 'Daily/2026-10-20.md' };
    vi.useFakeTimers();
    act(() =>
      emitServerEvent({ type: 'note:created', path: 'Daily/2026-10-20.md', revision: 'r' }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_QUERY_DEBOUNCE_MS);
    });
    vi.useRealTimers();
    expect(await screen.findByRole('button', { name: 'Ngày sau' })).toBeEnabled();
  });

  it('speaks English when the UI does', async () => {
    await i18n.changeLanguage('en');
    neighbors = { previous: null, next: 'Daily/2026-10-20.md' };
    render(<DailyNavRow path="Daily/2026-10-19.md" />);
    expect(screen.getByText('Monday, 19 October 2026')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Create 18 Oct' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next day' })).toBeInTheDocument();
  });
});
