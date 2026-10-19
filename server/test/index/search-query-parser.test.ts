import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  parseSearchQuery,
} from '../../src/index/search-query-parser.js';

describe('search query parsing', () => {
  it('separates filter tokens from free text', () => {
    const parsed = parseSearchQuery({
      q: 'giai tich tag:đồ-án due:7d folder:"2 Areas" type:course',
    });
    expect(parsed).toMatchObject({
      text: 'giai tich',
      tags: ['đồ-án'],
      due: '7d',
      folder: '2 Areas',
      type: 'course',
      includeArchive: false,
      limit: DEFAULT_SEARCH_LIMIT,
    });
  });

  it('accepts class:archive and keeps every tag filter', () => {
    const parsed = parseSearchQuery({ q: 'tag:#môn tag:đồ-án/ class:archive due:overdue' });
    expect(parsed.tags).toEqual(['môn', 'đồ-án']);
    expect(parsed.includeArchive).toBe(true);
    expect(parsed.due).toBe('overdue');
    expect(parsed.text).toBe('');
  });

  it('treats unknown keys and invalid filter values as free text', () => {
    const parsed = parseSearchQuery({ q: 'tga:x due:tomorrow class:wiki ghi:chú' });
    expect(parsed.text).toBe('tga:x due:tomorrow class:wiki ghi:chú');
    expect(parsed.due).toBeNull();
    expect(parsed.includeArchive).toBe(false);
  });

  it('drops a filter key that has no value yet (the user is still typing)', () => {
    expect(parseSearchQuery({ q: 'đồ án tag:' }).text).toBe('đồ án');
    expect(parseSearchQuery({ q: 'folder:"' }).folder).toBeNull();
  });

  it('allows an unterminated quoted value', () => {
    expect(parseSearchQuery({ q: 'folder:"1 Projects' }).folder).toBe('1 Projects');
  });

  it('merges explicit parameters with tokens in the query', () => {
    const parsed = parseSearchQuery({
      q: 'tag:a',
      tag: 'b',
      folder: '/0 Inbox/',
      due: '30d',
      class: 'archive',
    });
    expect(parsed.tags).toEqual(['b', 'a']);
    expect(parsed.folder).toBe('0 Inbox');
    expect(parsed.due).toBe('30d');
    expect(parsed.includeArchive).toBe(true);
  });

  it('clamps the limit', () => {
    expect(parseSearchQuery({ q: '', limit: 0 }).limit).toBe(1);
    expect(parseSearchQuery({ q: '', limit: 10_000 }).limit).toBe(MAX_SEARCH_LIMIT);
    expect(parseSearchQuery({ q: '', limit: Number.NaN }).limit).toBe(DEFAULT_SEARCH_LIMIT);
  });
});
