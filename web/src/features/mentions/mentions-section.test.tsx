import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MentionRef } from '../../lib/api/notes-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { TOAST_MS, useToastStore } from '../../lib/toast-store';
import { NotePanel } from '../backlinks/note-panel';

const NOTE = '2 Areas/Giải tích 1.md';

const mention: MentionRef = {
  path: '5 Daily/2026-10-17.md',
  title: '2026-10-17',
  revision: 'rev-daily-1',
  line: 4,
  context: 'Hôm nay học Giải tích 1 chương 2',
  highlight: [12, 23],
  start: 57,
  end: 68,
};

function renderPanel() {
  const router = createMemoryRouter([{ path: '/note', element: <NotePanel /> }], {
    initialEntries: [`/note?path=${encodeURIComponent(NOTE)}`],
  });
  render(<RouterProvider router={router} />);
}

async function openMentions() {
  const user = userEvent.setup();
  const region = await screen.findByRole('region', { name: /Nhắc đến chưa liên kết/ });
  await user.click(within(region).getByRole('button', { name: /Nhắc đến chưa liên kết/ }));
  return { user, region };
}

describe('note panel: unlinked mentions (F5.2)', () => {
  let mock: FetchMock;
  let mentions: MentionRef[];

  beforeEach(async () => {
    await resetAppState('vault-a');
    mentions = [mention];
    mock = installFetchMock();
    mock.on('GET /api/note', () => ({
      body: { path: NOTE, content: '# Giải tích 1\n', revision: 'r1', backlinks: [] },
    }));
    mock.on('GET /api/note/mentions', () => ({ body: { mentions } }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays collapsed and unfetched until opened, then lists mentions highlighted', async () => {
    renderPanel();
    await screen.findByText(/Chưa có ghi chú nào liên kết đến đây/);
    expect(mock.callsTo('GET /api/note/mentions')).toHaveLength(0);
    const { region } = await openMentions();
    const line = await within(region).findByRole('button', { name: /2026-10-17 Hôm nay học/ });
    expect(line.querySelector('mark')).toHaveTextContent('Giải tích 1');
    expect(mock.callsTo('GET /api/note/mentions')[0]?.query.get('path')).toBe(NOTE);
  });

  it('"Liên kết" sends the exact range and revision, then reloads the list', async () => {
    mock.on('POST /api/note/link-mention', () => {
      mentions = [];
      return { body: { revision: 'rev-daily-2' } };
    });
    renderPanel();
    const { user, region } = await openMentions();
    await user.click(
      await within(region).findByRole('button', {
        name: 'Liên kết lần nhắc trong 2026-10-17, dòng 4',
      }),
    );
    expect(mock.callsTo('POST /api/note/link-mention').map((call) => call.body)).toEqual([
      { path: mention.path, expectedRevision: 'rev-daily-1', start: 57, end: 68, target: NOTE },
    ]);
    expect(await within(region).findByText(/Không có ghi chú nào nhắc đến tên này/)).toBeVisible();
    expect(mock.callsTo('GET /api/note/mentions')).toHaveLength(2);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
      'Đã liên kết trong 2026-10-17.',
    ]);
    // The backlinks list refreshes right away too.
    await waitFor(() => expect(mock.callsTo('GET /api/note')).toHaveLength(2));
  });

  it.each([
    [409, 'CONFLICT'],
    [400, 'VALIDATION'],
  ])('a %i answer reloads the list and explains it in a 4 s toast', async (status, code) => {
    mock.on('POST /api/note/link-mention', () => {
      mentions = [{ ...mention, revision: 'rev-daily-2', start: 60, end: 71 }];
      return apiError(status, code, { currentRevision: 'rev-daily-2' });
    });
    renderPanel();
    const { user, region } = await openMentions();
    await user.click(await within(region).findByRole('button', { name: /^Liên kết lần nhắc/ }));
    await waitFor(() => expect(mock.callsTo('GET /api/note/mentions')).toHaveLength(2));
    const toasts = useToastStore.getState().toasts;
    expect(toasts.map((toast) => toast.message)).toEqual([
      'Ghi chú đã thay đổi, mình đã tải lại danh sách.',
    ]);
    expect(toasts[0]?.durationMs).toBe(TOAST_MS);
    // The next attempt uses the reloaded revision and offsets.
    mock.on('POST /api/note/link-mention', () => ({ body: { revision: 'rev-daily-3' } }));
    await waitFor(() =>
      expect(within(region).getByRole('button', { name: /^Liên kết lần nhắc/ })).toHaveAttribute(
        'aria-disabled',
        'false',
      ),
    );
    await user.click(within(region).getByRole('button', { name: /^Liên kết lần nhắc/ }));
    expect(mock.callsTo('POST /api/note/link-mention')[1]?.body).toMatchObject({
      expectedRevision: 'rev-daily-2',
      start: 60,
      end: 71,
    });
  });

  it('tells two mentions on the same line apart in the button names', async () => {
    mentions = [mention, { ...mention, start: 80, end: 91, highlight: [20, 31] }];
    renderPanel();
    const { region } = await openMentions();
    expect(
      await within(region).findByRole('button', {
        name: 'Liên kết lần nhắc thứ 1 trong 2026-10-17, dòng 4',
      }),
    ).toBeVisible();
    expect(
      within(region).getByRole('button', {
        name: 'Liên kết lần nhắc thứ 2 trong 2026-10-17, dòng 4',
      }),
    ).toBeVisible();
  });
});
