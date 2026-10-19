import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklinkRef, NoteResponse } from '../../lib/api/notes-types';
import type { Navigator } from '../../lib/app-navigation';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { NotePanel } from './note-panel';
import { PANEL_REFRESH_MS } from './use-panel-note';

const NOTE = '2 Areas/Giải tích 1.md';
const LINKING = '1 Projects/Đồ án Giải tích.md';

function noteBody(
  backlinks: BacklinkRef[],
  content = '# Giải tích 1\n\n## Giới hạn\n',
): NoteResponse {
  return {
    path: NOTE,
    content,
    revision: 'r1',
    utf8: true,
    mtime: 0,
    frontmatter: null,
    frontmatterError: null,
    backlinks,
    outlinks: [],
    tags: [],
    class: 'user',
  };
}

const backlink: BacklinkRef = {
  fromPath: LINKING,
  fromTitle: 'Đồ án Giải tích',
  line: 7,
  context: 'Ôn lại [[Giải tích 1]] trước khi nộp',
  highlight: [7, 22],
};

function renderPanel() {
  const router = createMemoryRouter([{ path: '/note', element: <NotePanel /> }], {
    initialEntries: [`/note?path=${encodeURIComponent(NOTE)}`],
  });
  render(<RouterProvider router={router} />);
}

describe('note panel: backlinks (F5.1)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  let backlinks: BacklinkRef[];

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
    backlinks = [];
    mock = installFetchMock();
    mock.on('GET /api/note', () => ({ body: noteBody(backlinks) }));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists each linking note with its line and the link highlighted', async () => {
    backlinks = [backlink];
    renderPanel();
    const item = await screen.findByRole('button', { name: /Đồ án Giải tích/ });
    const mark = item.querySelector('mark');
    expect(mark).toHaveTextContent('[[Giải tích 1]]');
    expect(mark).toHaveClass('text-highlight');
    expect(item).toHaveTextContent('Ôn lại [[Giải tích 1]] trước khi nộp');
    expect(mock.callsTo('GET /api/note')[0]?.query.get('path')).toBe(NOTE);
  });

  it('refetches within 1 s after a note event, debounced (fake timers)', async () => {
    renderPanel();
    expect(await screen.findByText(/Chưa có ghi chú nào liên kết đến đây/)).toBeInTheDocument();
    vi.useFakeTimers();
    backlinks = [backlink];
    act(() => {
      emitServerEvent({ type: 'note:changed', path: LINKING, revision: 'r2' });
      emitServerEvent({ type: 'note:changed', path: LINKING, revision: 'r3' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PANEL_REFRESH_MS - 50);
    });
    expect(mock.callsTo('GET /api/note')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(mock.callsTo('GET /api/note')).toHaveLength(2);
    expect(PANEL_REFRESH_MS).toBeLessThan(1000);
    vi.useRealTimers();
    expect(await screen.findByRole('button', { name: /Đồ án Giải tích/ })).toBeInTheDocument();
  });

  it('refetches after a reconnect (resync)', async () => {
    renderPanel();
    await screen.findByText(/Chưa có ghi chú nào liên kết đến đây/);
    backlinks = [backlink];
    act(() => emitServerEvent({ type: 'resync' }));
    expect(await screen.findByRole('button', { name: /Đồ án Giải tích/ })).toBeInTheDocument();
  });

  it('opens the linking note at its line; Ctrl+click opens a new tab', async () => {
    backlinks = [backlink];
    renderPanel();
    const item = await screen.findByRole('button', { name: /Đồ án Giải tích/ });
    fireEvent.click(item);
    const lineRoute = `/note?path=${encodeURIComponent(LINKING)}&line=7`;
    expect(navigate).toHaveBeenLastCalledWith(lineRoute, { replace: true });
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([LINKING]);
    fireEvent.click(item, { ctrlKey: true });
    // Already open: the existing tab is activated instead of a duplicate (tabs are deduplicated).
    expect(useTabsStore.getState().tabs).toHaveLength(1);
    act(() => useTabsStore.getState().openNote('0 Inbox/Khác.md'));
    fireEvent.click(item, { ctrlKey: true });
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([
      '0 Inbox/Khác.md',
      LINKING,
    ]);
  });

  it('shows the outline and moves to a heading line; sections collapse', async () => {
    const user = userEvent.setup();
    renderPanel();
    const outline = await screen.findByRole('region', { name: 'Mục lục' });
    await user.click(within(outline).getByRole('button', { name: 'Giới hạn' }));
    expect(navigate).toHaveBeenLastCalledWith(`/note?path=${encodeURIComponent(NOTE)}&line=3`, {
      replace: true,
    });
    const toggle = within(outline).getByRole('button', { name: 'Mục lục' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(outline).queryByRole('button', { name: 'Giới hạn' })).toBeNull();
  });
});
