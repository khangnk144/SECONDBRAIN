import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSearchUi } from '../../lib/search-ui-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { SearchPalette } from '../search/search-palette';
import { TagsScreen } from './tags-screen';

const TAGS = [
  { tag: 'môn/giải-tích', norm: 'môn/giải-tích', count: 3 },
  { tag: 'đồ-án', norm: 'đồ-án', count: 2 },
  { tag: 'môn', norm: 'môn', count: 1 },
];

function renderScreen() {
  render(
    <>
      <TagsScreen />
      <SearchPalette />
    </>,
  );
}

describe('tags view (F6.2, F6.3)', () => {
  let mock: FetchMock;
  let tags: typeof TAGS;

  beforeEach(async () => {
    await resetAppState('vault-a');
    tags = TAGS;
    mock = installFetchMock();
    mock.on('GET /api/tags', () => ({ body: { tags } }));
    mock.on('GET /api/search', () => ({
      body: {
        results: [
          {
            path: '2 Areas/Giải tích 1.md',
            title: 'Giải tích 1',
            folder: '2 Areas',
            class: 'user',
            matchedIn: 'filter',
            snippet: null,
            score: 0,
          },
        ],
      },
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('nests tags by "/" with the server counts, in Vietnamese order', async () => {
    renderScreen();
    const list = await screen.findByRole('list', { name: 'Danh sách thẻ' });
    const top = within(list)
      .getAllByRole('listitem')
      .filter((item) => item.parentElement === list);
    expect(top.map((item) => item.querySelector('button')?.textContent)).toEqual([
      '#đồ-án2',
      '#môn1',
    ]);
    const child = within(top[1] as HTMLElement).getByRole('button', {
      name: 'Thẻ #môn/giải-tích, 3 ghi chú',
    });
    expect(child).toHaveTextContent('#giải-tích3');
  });

  it('clicking a tag opens the palette with tag:<tag> and the filtered search', async () => {
    const user = userEvent.setup();
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Thẻ #môn/giải-tích, 3 ghi chú' }));
    expect(useSearchUi.getState()).toMatchObject({ open: true, query: 'tag:môn/giải-tích' });
    const dialog = screen.getByRole('dialog', { name: 'Tìm ghi chú' });
    expect(within(dialog).getByRole('combobox')).toHaveValue('tag:môn/giải-tích');
    expect(await within(dialog).findByRole('option', { name: /Giải tích 1/ })).toBeVisible();
    expect(mock.callsTo('GET /api/search').map((call) => call.query.get('q'))).toEqual([
      'tag:môn/giải-tích',
    ]);
  });

  it('invites to type # when there are no tags, and refetches on note events', async () => {
    tags = [];
    renderScreen();
    expect(await screen.findByText(/Chưa có thẻ nào. Gõ # trong một ghi chú/)).toBeVisible();
    tags = TAGS;
    act(() => emitServerEvent({ type: 'note:changed', path: 'a.md', revision: 'r2' }));
    expect(await screen.findByRole('list', { name: 'Danh sách thẻ' })).toBeVisible();
    expect(mock.callsTo('GET /api/tags')).toHaveLength(2);
  });
});
