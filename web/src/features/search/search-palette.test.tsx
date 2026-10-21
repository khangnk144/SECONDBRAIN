import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../../lib/api/search-types';
import type { Navigator } from '../../lib/app-navigation';
import { useSearchUi } from '../../lib/search-ui-store';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { SearchPalette } from './search-palette';
import { SEARCH_DEBOUNCE_MS } from './use-palette-results';

const hit = (path: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1, -3),
  folder: path.split('/')[0] ?? '',
  class: 'user',
  matchedIn: 'title',
  snippet: null,
  score: 1,
  ...extra,
});

function renderWithOpener() {
  render(
    <>
      <button type="button" onClick={() => useSearchUi.getState().openSearch()}>
        opener
      </button>
      <SearchPalette />
    </>,
  );
}

async function openPalette(user = userEvent.setup()) {
  await user.click(screen.getByRole('button', { name: 'opener' }));
  const dialog = screen.getByRole('dialog', { name: 'Tìm ghi chú' });
  return { user, dialog, input: within(dialog).getByRole('combobox', { name: 'Tìm ghi chú' }) };
}

describe('search palette (F8 overlay, F23 new tab)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  let answer: (q: string) => SearchResult[];

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
    answer = () => [];
    mock = installFetchMock();
    mock.on('GET /api/search', (call) => ({
      body: { results: answer(call.query.get('q') ?? '') },
    }));
    renderWithOpener();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens focused and lists recently opened notes for an empty query', async () => {
    useTabsStore.setState({
      tabs: [
        { id: 't1', path: '0 Inbox/Ý tưởng.md', lastActive: 5 },
        { id: 't2', path: '1 Projects/Đồ án.md', lastActive: 9 },
      ],
      activeId: 't2',
    });
    answer = () => [
      hit('2 Areas/Giải tích 1.md', { matchedIn: 'recent' }),
      hit('1 Projects/Đồ án.md'),
    ];
    const { dialog, input } = await openPalette();
    expect(input).toHaveFocus();
    const list = within(dialog).getByRole('listbox', { name: 'Ghi chú mở gần đây' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(3));
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Đồ án1 Projects', 'Ý tưởng0 Inbox', 'Giải tích 12 Areas']);
    expect(mock.callsTo('GET /api/search')[0]?.query.get('q')).toBe('');
    expect(input).toHaveAttribute('aria-controls', list.id);
    expect(input).toHaveAttribute('aria-expanded', 'true');
  });

  it('waits 120 ms after typing and sends the query unchanged (NFD stays NFD)', async () => {
    const { input } = await openPalette();
    await waitFor(() => expect(mock.callsTo('GET /api/search')).toHaveLength(1));
    vi.useFakeTimers();
    const nfd = 'giải tích'.normalize('NFD');
    fireEvent.change(input, { target: { value: 'g' } });
    fireEvent.change(input, { target: { value: 'gi' } });
    fireEvent.change(input, { target: { value: nfd } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 20);
    });
    expect(mock.callsTo('GET /api/search')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    const calls = mock.callsTo('GET /api/search');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.query.get('q')).toBe(nfd);
    expect(calls[1]?.query.get('q')).not.toBe(nfd.normalize('NFC'));
  });

  it('puts title matches first and shows folder and highlighted snippet', async () => {
    answer = (q) =>
      q === 'newton'
        ? [
            hit('3 Resources/Phương pháp số.md', {
              matchedIn: 'body',
              snippet: { text: '…dùng phương pháp Newton để…', highlights: [[18, 24]] },
            }),
            hit('wiki/concepts/Newton.md'),
          ]
        : [];
    const { user, dialog, input } = await openPalette();
    await user.type(input, 'newton');
    const list = within(dialog).getByRole('listbox', { name: 'Kết quả tìm kiếm' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
    const [first, second] = within(list).getAllByRole('option');
    expect(first).toHaveTextContent('Newtonwiki/concepts');
    expect(second?.querySelector('mark')).toHaveTextContent('Newton');
    expect(second).toHaveTextContent('3 Resources');
  });

  it('↓/↑ move the active row, Enter opens, Ctrl+Enter opens in a new tab', async () => {
    answer = () => [hit('a/Một.md'), hit('b/Hai.md')];
    const { user, dialog, input } = await openPalette();
    const options = await within(dialog).findAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id);
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    // Ctrl+K inside the palette is kept from the browser and leaves the palette open.
    // fireEvent returns false when the default action was prevented.
    expect(fireEvent.keyDown(input, { key: 'k', ctrlKey: true })).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{ArrowDown}{ArrowUp}{ArrowDown}{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['b/Hai.md']);
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent('b/Hai.md')}`,
      undefined,
    );

    // Reopened with the same blank query: the note just opened now leads the recent list.
    const again = await openPalette(user);
    await waitFor(() =>
      expect(
        within(again.dialog)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['Haib', 'Mộta']),
    );
    await user.keyboard('{ArrowDown}{Control>}{Enter}{/Control}');
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual(['b/Hai.md', 'a/Một.md']);
  });

  it('Esc closes and gives focus back to the opener', async () => {
    const { user } = await openPalette();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useSearchUi.getState().open).toBe(false);
    expect(screen.getByRole('button', { name: 'opener' })).toHaveFocus();
  });

  it('without results offers "Tạo \'<q>\'", which creates the note in Inbox', async () => {
    mock.on('POST /api/note', (call) => ({
      body: { path: (call.body as { path: string }).path, revision: 'r1' },
    }));
    const { user, dialog, input } = await openPalette();
    await user.type(input, 'ma trận');
    expect(await within(dialog).findByText("Không có ghi chú nào khớp 'ma trận'.")).toBeVisible();
    const create = within(dialog).getByRole('option', { name: "Tạo 'ma trận'" });
    expect(create).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(mock.callsTo('POST /api/note')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
      path: '0 Inbox/ma trận.md',
      unique: true,
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers no "Tạo" for a filter query that matches nothing', async () => {
    const { user, dialog, input } = await openPalette();
    await user.type(input, 'tag:không-có');
    expect(
      await within(dialog).findByText("Không có ghi chú nào khớp 'tag:không-có'."),
    ).toBeVisible();
    expect(within(dialog).queryByRole('option')).toBeNull();
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });

  it('still offers "Tạo" after unrelated results, but not when a result has exactly that title', async () => {
    answer = (q) =>
      q === 'ma trận'
        ? [hit('2 Areas/Đại số tuyến tính.md', { matchedIn: 'body' })]
        : [hit('2 Areas/Ma trận.md')];
    const { user, dialog, input } = await openPalette();
    await user.type(input, 'ma trận');
    expect(await within(dialog).findByRole('option', { name: "Tạo 'ma trận'" })).toBeVisible();
    expect(within(dialog).getByRole('option', { name: /Đại số tuyến tính/ })).toBeVisible();
    await user.clear(input);
    await user.type(input, 'Ma trận ');
    await within(dialog).findByRole('option', { name: /^Ma trận/ });
    expect(within(dialog).queryByRole('option', { name: /^Tạo/ })).toBeNull();
  });
});
