import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingJournalEntry } from '../../lib/api/journal-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { ToastHost } from '../toasts/toast-host';
import { JournalBanner } from './journal-banner';
import { startJournalSync, useJournalStore } from './journal-store';

const entry: PendingJournalEntry = {
  id: '01JOURNALPEND',
  op: 'rename',
  status: 'failed',
  createdAt: '2026-10-19T08:00:00Z',
  totalSteps: 8,
  appliedSteps: 3,
  paths: ['1 Projects/Bài 1.md'],
};

describe('unfinished operation banner (SPEC §4.12)', () => {
  let mock: FetchMock;
  let stop: () => void;
  beforeEach(async () => {
    await resetAppState();
    useJournalStore.setState({ entries: [], busyId: null });
    mock = installFetchMock();
    stop = startJournalSync();
  });
  afterEach(() => {
    stop();
    vi.unstubAllGlobals();
  });

  it('shows pending entries pushed over WS with "Hoàn tất" and reports the result', async () => {
    const user = userEvent.setup();
    render(
      <>
        <JournalBanner />
        <ToastHost />
      </>,
    );
    act(() => emitServerEvent({ type: 'journal:pending', entries: [entry] }));
    expect(screen.getByText('Một thao tác đổi tên chưa hoàn tất (3/8 file).')).toBeInTheDocument();
    mock.on('POST /api/journal/01JOURNALPEND/complete', { body: { ok: true } });
    mock.on('GET /api/journal/pending', { body: { entries: [] } });
    await user.click(screen.getByRole('button', { name: 'Hoàn tất' }));
    await waitFor(() => expect(screen.queryByText(/chưa hoàn tất/)).toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent('Đã hoàn tất thao tác.');
  });

  it('"Hoàn tác" refused by a changed file says so and keeps the entry', async () => {
    const user = userEvent.setup();
    render(<JournalBanner />);
    mock.on('GET /api/journal/pending', { body: { entries: [{ ...entry, op: 'folder-trash' }] } });
    await act(async () => {
      await useJournalStore.getState().fetchPending();
    });
    expect(screen.getByText('Một thao tác xóa chưa hoàn tất (3/8 file).')).toBeInTheDocument();
    mock.on(
      'POST /api/journal/01JOURNALPEND/undo',
      apiError(409, 'CONFLICT', { journalId: entry.id, conflicts: [{ path: 'a.md' }] }),
    );
    await user.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    await waitFor(() =>
      expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
        'Không hoàn tác được vì ghi chú “a” đã được sửa sau đó.',
      ),
    );
    expect(screen.getByText(/chưa hoàn tất/)).toBeInTheDocument();
  });
});
