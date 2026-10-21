import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useAiStatusStore } from '../../lib/ai-status-store';
import type { AiSearchResult, AiStatus } from '../../lib/api/ai-types';
import { withQuery } from '../../lib/api/query-string';
import type { SearchResult } from '../../lib/api/search-types';
import { FILE_ROUTE, fileRoute, type Navigator } from '../../lib/app-navigation';
import { useSearchUi } from '../../lib/search-ui-store';
import { installFetchMock, type FetchMock, type MockReply } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { startOpenVaultFile } from '../viewer/open-vault-file-in-app';
import { SearchPalette } from './search-palette';
import { SEMANTIC_DEBOUNCE_MS } from './use-semantic-results';

const PDF = '3 Resources/papers/bài giảng 3.pdf';
const ALGEBRA = '2 Areas/Đại số tuyến tính.md';
const CHAPTER = '2 Areas/Đại số tuyến tính – chương 3.md';

const hit = (path: string, extra: Partial<SearchResult> = {}): SearchResult => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  folder: path.slice(0, path.lastIndexOf('/')),
  class: 'user',
  matchedIn: 'body',
  snippet: null,
  score: 1,
  ...extra,
});

const meaning = (path: string, page: number | null = null): AiSearchResult => ({
  path,
  title: path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''),
  snippet: 'ma trận vuông và định thức',
  page,
  score: 1,
});

function aiStatus(overrides: Partial<AiStatus> = {}): AiStatus {
  return {
    available: true,
    enabled: true,
    consented: true,
    provider: 'anthropic',
    hasKey: true,
    chatModel: 'model',
    ready: true,
    reason: null,
    retrieval: 'hybrid',
    embeddings: {
      enabled: true,
      consented: true,
      provider: 'openai',
      model: 'embed',
      hasKey: true,
      state: 'idle',
      done: 10,
      total: 10,
      pending: 0,
      lastError: null,
    },
    usage: { month: '2026-10', tokens: 0, limit: 100_000, paused: false },
    scope: ['1 Projects', '2 Areas'],
    ...overrides,
  };
}

const setStatus = (status: AiStatus | null) => act(() => useAiStatusStore.setState({ status }));

// Fake timers drive the debounces; typing is a change event per step (userEvent waits on timers).
function openPalette() {
  act(() => useSearchUi.getState().openSearch());
  const dialog = screen.getByRole('dialog', { name: 'Tìm ghi chú' });
  return { dialog, input: within(dialog).getByRole('combobox', { name: 'Tìm ghi chú' }) };
}

const typeQuery = (input: HTMLElement, value: string) =>
  act(() => {
    fireEvent.change(input, { target: { value } });
  });
const press = (input: HTMLElement, key: string) =>
  act(() => {
    fireEvent.keyDown(input, { key });
  });

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

describe('palette: search mode, "Theo nghĩa" and PDF pages (F33.3, F30.1)', () => {
  let mock: FetchMock;
  let navigate: Mock<Navigator>;
  let keyword: (q: string) => SearchResult[];
  let byMeaning: (q: string) => MockReply | Promise<MockReply>;
  let stopOpen: () => void;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as Mock<Navigator>;
    vi.useFakeTimers();
    keyword = () => [];
    byMeaning = () => ({ body: { mode: 'hybrid', results: [] } });
    mock = installFetchMock();
    mock.on('GET /api/search', (call) => ({
      body: { results: keyword(call.query.get('q') ?? '') },
    }));
    mock.on('POST /api/ai/search', (call) => byMeaning((call.body as { q: string }).q));
    stopOpen = startOpenVaultFile();
    render(<SearchPalette />);
  });
  afterEach(() => {
    stopOpen();
    useSearchUi.getState().close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('labels the mode: BM25 unless hybrid retrieval is ready; none for commands', async () => {
    const { dialog, input } = openPalette();
    expect(within(dialog).getByText('Tìm theo từ khóa (BM25)')).toBeInTheDocument();
    setStatus(aiStatus());
    expect(within(dialog).getByText('Từ khóa và theo nghĩa')).toBeInTheDocument();
    setStatus(aiStatus({ ready: false, reason: 'budget' }));
    expect(within(dialog).getByText('Tìm theo từ khóa (BM25)')).toBeInTheDocument();
    setStatus(aiStatus({ retrieval: 'bm25' }));
    expect(within(dialog).getByText('Tìm theo từ khóa (BM25)')).toBeInTheDocument();
    typeQuery(input, '>');
    expect(within(dialog).queryByText('Tìm theo từ khóa (BM25)')).toBeNull();
  });

  it('asks by meaning only for 3+ characters, 400 ms after typing stops, the last query only', async () => {
    setStatus(aiStatus());
    byMeaning = () => ({ body: { mode: 'hybrid', results: [meaning(CHAPTER)] } });
    const { dialog, input } = openPalette();
    typeQuery(input, 'ma');
    await advance(1_000);
    expect(mock.callsTo('POST /api/ai/search')).toHaveLength(0);
    typeQuery(input, 'ma t');
    await advance(SEMANTIC_DEBOUNCE_MS - 1);
    typeQuery(input, 'ma tr');
    await advance(SEMANTIC_DEBOUNCE_MS - 1);
    expect(mock.callsTo('POST /api/ai/search')).toHaveLength(0);
    expect(within(dialog).queryByRole('group', { name: 'Theo nghĩa' })).toBeNull();
    await advance(1);
    expect(mock.callsTo('POST /api/ai/search').map((c) => c.body)).toEqual([
      { q: 'ma tr', limit: 8 },
    ]);
    const group = within(dialog).getByRole('group', { name: 'Theo nghĩa' });
    expect(within(group).getByRole('option')).toHaveTextContent(
      'Đại số tuyến tính – chương 3' + '2 Areas' + 'ma trận vuông và định thức',
    );
  });

  it('drops an answer to a query typed past and never repeats a keyword result', async () => {
    setStatus(aiStatus());
    let release: (reply: MockReply) => void = () => undefined;
    byMeaning = () => new Promise<MockReply>((resolve) => (release = resolve));
    keyword = (q) => (q === 'ma trận' ? [hit(ALGEBRA)] : []);
    const { dialog, input } = openPalette();
    typeQuery(input, 'ma tr');
    await advance(SEMANTIC_DEBOUNCE_MS);
    const first = release;
    byMeaning = () => ({
      body: { mode: 'hybrid', results: [meaning(ALGEBRA), meaning(CHAPTER), meaning(CHAPTER)] },
    });
    typeQuery(input, 'ma trận');
    await advance(SEMANTIC_DEBOUNCE_MS);
    first({ body: { mode: 'hybrid', results: [meaning('1 Projects/Cũ.md')] } });
    await advance(0);
    const group = within(dialog).getByRole('group', { name: 'Theo nghĩa' });
    expect(
      within(group)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Đại số tuyến tính – chương 3' + '2 Areas' + 'ma trận vuông và định thức']);
    expect(within(dialog).queryByText('Cũ')).toBeNull();
  });

  it('never asks by meaning in BM25 mode, when AI is not ready, or for filters', async () => {
    const { input } = openPalette();
    typeQuery(input, 'ma trận');
    await advance(1_000);
    setStatus(aiStatus({ retrieval: 'bm25' }));
    typeQuery(input, 'ma trận a');
    await advance(1_000);
    setStatus(aiStatus({ ready: false, reason: 'no-key' }));
    typeQuery(input, 'ma trận ab');
    await advance(1_000);
    setStatus(aiStatus());
    typeQuery(input, 'tag:đồ-án');
    await advance(1_000);
    expect(mock.callsTo('POST /api/ai/search')).toHaveLength(0);
  });

  it('a PDF hit shows "tr. N" and opens the viewer at that page', async () => {
    keyword = () => [hit(PDF, { class: 'source', page: 4, title: 'bài giảng 3.pdf' })];
    const { dialog, input } = openPalette();
    typeQuery(input, 'tích phân');
    await advance(200);
    const option = within(dialog).getByRole('option', { name: /bài giảng 3\.pdf/ });
    expect(option).toHaveTextContent('bài giảng 3.pdftr. 43 Resources/papers');
    expect(option.querySelector('svg')).not.toBeNull();
    press(input, 'Enter');
    expect(navigate).toHaveBeenCalledWith(fileRoute(PDF), undefined);
    expect(navigate).toHaveBeenLastCalledWith(withQuery(FILE_ROUTE, { path: PDF, page: 4 }), {
      replace: true,
    });
  });

  it('the keyboard reaches the "Theo nghĩa" rows; Enter opens a PDF page from there', async () => {
    setStatus(aiStatus());
    keyword = () => [hit(ALGEBRA)];
    byMeaning = () => ({ body: { mode: 'hybrid', results: [meaning(PDF, 7)] } });
    const { dialog, input } = openPalette();
    typeQuery(input, 'định thức');
    await advance(SEMANTIC_DEBOUNCE_MS + 10);
    const group = within(dialog).getByRole('group', { name: 'Theo nghĩa' });
    const row = within(group).getByRole('option');
    expect(row).toHaveTextContent('tr. 7');
    // The hits by meaning come last, after the keyword hit and "Tạo 'định thức'".
    const index = within(dialog).getAllByRole('option').indexOf(row);
    expect(index).toBeGreaterThanOrEqual(2);
    for (let step = 0; step < index; step += 1) press(input, 'ArrowDown');
    expect(input).toHaveAttribute('aria-activedescendant', row.id);
    press(input, 'Enter');
    expect(navigate).toHaveBeenLastCalledWith(withQuery(FILE_ROUTE, { path: PDF, page: 7 }), {
      replace: true,
    });
  });
});
