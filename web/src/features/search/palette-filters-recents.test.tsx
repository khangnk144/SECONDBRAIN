import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '../../lib/api/search-types';
import { useRecentNotes } from '../../lib/recent-notes-store';
import { useSearchUi } from '../../lib/search-ui-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { makeTree } from '../../lib/testing/tree-fixture';
import { useTreeStore } from '../../lib/tree-store';
import { PALETTE_MEASURE } from './palette-timing';
import { SearchPalette } from './search-palette';

const result = (path: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1, -3),
  folder: path.split('/')[0] ?? '',
  class: 'user',
  matchedIn: 'filter',
  snippet: null,
  score: 1,
  ...extra,
});

async function openPalette() {
  act(() => useSearchUi.getState().openSearch());
  const dialog = screen.getByRole('dialog', { name: 'Tìm ghi chú' });
  return { dialog, input: within(dialog).getByRole('combobox') };
}

const optionTexts = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('option')
    .map((option) => option.textContent);

describe('palette filters (F8.3)', () => {
  let mock: FetchMock;

  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    // The mocked server: archived notes only with class:archive (the server's rule).
    mock.on('GET /api/search', (call) => {
      const q = call.query.get('q') ?? '';
      if (!q.startsWith('tag:đồ-án due:7d')) return { body: { results: [] } };
      const results = [result('1 Projects/Đồ án Giải tích.md')];
      if (q.includes('class:archive')) {
        results.push(result('4 Archive/Đồ án cũ.md', { class: 'archived' }));
      }
      return { body: { results } };
    });
    mock.on('GET /api/tags', {
      body: {
        tags: [
          { tag: 'đồ-án', norm: 'do-an', count: 3 },
          { tag: 'giải-tích', norm: 'giai-tich', count: 1 },
        ],
      },
    });
    render(<SearchPalette />);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('explains the filters under the input', async () => {
    const { dialog, input } = await openPalette();
    const hint = within(dialog).getByText(/^Lọc bằng tag:, folder:, type:/);
    expect(input.getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('`tag:` suggests the server tags; Enter completes and the query goes out unchanged', async () => {
    const user = userEvent.setup();
    const { dialog, input } = await openPalette();
    await user.type(input, 'tag:do');
    await waitFor(() => expect(optionTexts(dialog)[0]).toBe('tag:đồ-án3 ghi chú'));
    expect(mock.callsTo('GET /api/tags')).toHaveLength(1);
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('tag:đồ-án ');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.type(input, 'due:');
    await waitFor(() =>
      expect(optionTexts(dialog).slice(0, 3)).toEqual([
        'due:7dhạn trong 7 ngày tới',
        'due:30dhạn trong 30 ngày tới',
        'due:overdueđã quá hạn',
      ]),
    );
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('tag:đồ-án due:7d ');
    // Only what the server returns, no archived note, no "Tạo", no commands.
    await waitFor(() => expect(optionTexts(dialog)).toEqual(['Đồ án Giải tích1 Projects']));
    const sent = mock.callsTo('GET /api/search').at(-1);
    expect(sent?.query.get('q')).toBe('tag:đồ-án due:7d ');
    expect([...(sent?.query.keys() ?? [])]).toEqual(['q']);
    expect(mock.callsTo('GET /api/tags')).toHaveLength(1);

    await user.type(input, 'class:a');
    await waitFor(() =>
      expect(optionTexts(dialog)[0]).toBe('class:archivegồm cả ghi chú trong Archive'),
    );
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('tag:đồ-án due:7d class:archive ');
    await waitFor(() =>
      expect(optionTexts(dialog)).toEqual(['Đồ án Giải tích1 Projects', 'Đồ án cũ4 Archive']),
    );
  });

  it('`folder:` suggests the tree folders, quoted when they have a space', async () => {
    useTreeStore.setState({
      tree: makeTree({
        folders: ['0 Inbox', '1 Projects', '1 Projects/Web', 'Templates'],
        notes: [],
      }),
      status: 'ready',
    });
    const user = userEvent.setup();
    const { dialog, input } = await openPalette();
    await user.type(input, 'folder:proj');
    await waitFor(() =>
      expect(optionTexts(dialog).slice(0, 2)).toEqual([
        'folder:"1 Projects"',
        'folder:"1 Projects/Web"',
      ]),
    );
    await user.keyboard('{Enter}');
    expect(input).toHaveValue('folder:"1 Projects" ');
  });
});

describe('palette recents and timing (F8, F8.1)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    mock.on('GET /api/search', (call) => ({
      body: { results: call.query.get('q') ? [result('a/Kết quả.md')] : [] },
    }));
    render(<SearchPalette />);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a blank query shows the 8 most recently opened notes, newest first', async () => {
    const paths = Array.from({ length: 10 }, (_, i) => `0 Inbox/Ghi chú ${i + 1}.md`);
    for (const path of paths) useRecentNotes.getState().record(path);
    const { dialog } = await openPalette();
    const list = await within(dialog).findByRole('listbox', { name: 'Ghi chú mở gần đây' });
    await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(8));
    expect(optionTexts(dialog)[0]).toBe('Ghi chú 100 Inbox');
    expect(optionTexts(dialog)[7]).toBe('Ghi chú 30 Inbox');
    expect(mock.callsTo('GET /api/search')).toHaveLength(0);
  });

  it('records a keystroke-to-results measure once the results for that query are shown', async () => {
    const before = performance.getEntriesByName(PALETTE_MEASURE).length;
    const user = userEvent.setup();
    const { dialog, input } = await openPalette();
    await user.type(input, 'kết');
    await waitFor(() => expect(optionTexts(dialog)[0]).toBe('Kết quảa'));
    await waitFor(() =>
      expect(performance.getEntriesByName(PALETTE_MEASURE).length).toBe(before + 1),
    );
  });
});
