import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TagCount } from '../../lib/api/search-types';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { saveMarkdown } from '../markdown/markdown-document';
import { renderEditor } from '../__tests__/render-editor';
import { rankTags, resetTagSuggestions } from './tag-suggestions';

const TAGS: TagCount[] = [
  { tag: 'đồ-án', norm: 'đồ-án', count: 4 },
  { tag: 'môn/giải-tích', norm: 'môn/giải-tích', count: 3 },
  { tag: 'môn/đại-số', norm: 'môn/đại-số', count: 2 },
  { tag: 'ôn-thi', norm: 'ôn-thi', count: 1 },
];

describe('# tag autocomplete (F6.1)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    resetTagSuggestions();
    mock = installFetchMock();
    mock.on('GET /api/tags', { body: { tags: TAGS } });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('matches without diacritics and by any / segment', () => {
    expect(rankTags(TAGS, 'do-an').map((t) => t.tag)).toEqual(['đồ-án']);
    expect(rankTags(TAGS, 'mon/').map((t) => t.tag)).toEqual(['môn/giải-tích', 'môn/đại-số']);
    expect(rankTags(TAGS, 'giai').map((t) => t.tag)).toEqual(['môn/giải-tích']);
    expect(rankTags(TAGS, 'on').map((t) => t.tag)).toEqual([
      'ôn-thi',
      'môn/giải-tích',
      'môn/đại-số',
    ]);
  });

  it('suggests existing tags, shows nesting, and inserts the chosen tag as text', async () => {
    const t = renderEditor('Việc\n');
    t.caretAfter('Việc');
    t.type(' #do');
    const listbox = await screen.findByRole('listbox', { name: 'Gợi ý thẻ' });
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['#đồ-án4 ghi chú']);
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe('Việc #đồ-án\n');
    expect(t.root.querySelector('.tag-pill')).toHaveTextContent('#đồ-án');
  });

  it('a tag chosen in front of a word gets a space after it', async () => {
    const t = renderEditor('Việc làm\n');
    t.caretAfter('Việc ');
    t.type('#do');
    await screen.findByRole('listbox', { name: 'Gợi ý thẻ' });
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe('Việc #đồ-án làm\n');
  });

  it('nested tags show their parent path', async () => {
    const t = renderEditor('Việc\n');
    t.caretAfter('Việc');
    t.type(' #mon/');
    const options = await screen.findAllByRole('option');
    expect(options[0]!.querySelector('.tag-option__parent')).toHaveTextContent('môn/');
    expect(options[0]).toHaveTextContent('#môn/giải-tích');
  });

  it('a lone # at the start of a line waits for a letter (it may become a heading)', async () => {
    const t = renderEditor('x\n');
    t.newLine();
    t.type('#');
    await Promise.resolve();
    expect(screen.queryByRole('listbox')).toBeNull();
    t.type(' Tiêu đề');
    expect(t.editor.state.doc.lastChild!.type.name).toBe('heading');
  });

  it('fetches tags again after a note changed', async () => {
    const t = renderEditor('x\n');
    t.caretAfter('x');
    t.type(' #d');
    await screen.findByRole('listbox');
    expect(mock.callsTo('GET /api/tags')).toHaveLength(1);
    t.press('Escape');
    emitServerEvent({ type: 'note:changed', path: 'a.md', revision: 'r' });
    t.type(' #o');
    await screen.findByRole('listbox');
    expect(mock.callsTo('GET /api/tags')).toHaveLength(2);
  });
});
