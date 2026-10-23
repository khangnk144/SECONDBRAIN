import { describe, expect, it } from 'vitest';
import {
  EMPTY_GRAPH_FILTER,
  graphFilterMatches,
  isGraphFilterActive,
  normalizeGraphTag,
  type GraphFilter,
} from '../../src/graph/graph-filter.js';
import { parseGraphFilterQuery } from '../../src/graph/graph-filter-query.js';
import { DAY, FILTER_NODES, nfd, NOW } from './graph-filter-fixture.js';

const filter = (partial: Partial<GraphFilter>): GraphFilter => ({
  ...EMPTY_GRAPH_FILTER,
  ...partial,
});
const ids = (f: GraphFilter) => graphFilterMatches(f, FILTER_NODES);

describe('graph filter predicate (F24.2)', () => {
  it('(F24.2) no filter: everything matches and the filter is inactive', () => {
    expect(isGraphFilterActive(EMPTY_GRAPH_FILTER)).toBe(false);
    expect(isGraphFilterActive(filter({ tag: '  ' }))).toBe(false);
    expect(ids(EMPTY_GRAPH_FILTER)).toHaveLength(FILTER_NODES.length);
  });

  it('(F24.2) folders by top folder name (case and NFC insensitive) or by colour group, any of them', () => {
    expect(ids(filter({ folders: ['1 projects'] }))).toEqual(['1 Projects/Đồ án Giải tích.md']);
    expect(ids(filter({ folders: ['0 INBOX', nfd('Daily')] }))).toEqual([
      'Daily/2026-10-22.md',
      '0 Inbox/Bài cũ.md',
    ]);
    expect(ids(filter({ groups: ['other', 'resources'] }))).toEqual([
      '0 Inbox/Bài cũ.md',
      'Ghi chú gốc.md',
      '3 Resources/papers/bài 1.pdf',
    ]);
    expect(ids(filter({ folders: ['Daily'], groups: ['areas'] }))).toEqual([
      '2 Areas/Giải tích 1.md',
      'Daily/2026-10-22.md',
    ]);
  });

  it('(F24.2) tags in the §4.14 form: Vietnamese, NFD or NFC, with #, nested tags match their parent', () => {
    expect(normalizeGraphTag(nfd('#Đồ-Án'))).toBe(normalizeGraphTag('đồ-án'));
    expect(normalizeGraphTag('#Đồ-Án')).toBe('dồ-án');
    expect(ids(filter({ tag: nfd('#ĐỒ-ÁN') }))).toEqual(['0 Inbox/Bài cũ.md']);
    expect(ids(filter({ tag: 'do-an' }))).toEqual(['1 Projects/Đồ án Giải tích.md']);
    expect(ids(filter({ tag: nfd('Môn') }))).toEqual(['2 Areas/Giải tích 1.md']);
    expect(ids(filter({ tag: 'mon' }))).toEqual(['1 Projects/Đồ án Giải tích.md']);
    // A prefix that is not a whole parent tag does not match.
    expect(ids(filter({ tag: 'mo' }))).toEqual([]);
  });

  it('(F24.2) time: created or edited at or after since; sources never match a time filter', () => {
    expect(ids(filter({ since: NOW - DAY }))).toEqual(['Daily/2026-10-22.md', '0 Inbox/Bài cũ.md']);
    expect(ids(filter({ since: NOW - 7 * DAY }))).toEqual([
      '1 Projects/Đồ án Giải tích.md',
      'Daily/2026-10-22.md',
      '0 Inbox/Bài cũ.md',
    ]);
    expect(ids(filter({ since: NOW - 2 * DAY }))).toContain('1 Projects/Đồ án Giải tích.md');
    expect(ids(filter({ since: 0 }))).not.toContain('3 Resources/papers/bài 1.pdf');
  });

  it('(F24.2) dimensions combine with AND', () => {
    expect(ids(filter({ groups: ['other'], tag: 'đồ-án', since: NOW - DAY }))).toEqual([
      '0 Inbox/Bài cũ.md',
    ]);
    expect(ids(filter({ groups: ['projects'], since: NOW - DAY }))).toEqual([]);
  });

  it('(F24.2) query parsing: repeated or comma folders, groups, tag, date or instant since', () => {
    expect(parseGraphFilterQuery({})).toBeNull();
    expect(
      parseGraphFilterQuery({
        folder: ['1 Projects,Daily', ' 2 Areas ', ''],
        group: ['wiki', 'wiki'],
      }),
    ).toEqual({
      folders: ['1 Projects', 'Daily', '2 Areas'],
      groups: ['wiki'],
      tag: null,
      since: null,
    });
    expect(parseGraphFilterQuery({ since: '2026-10-16' })?.since).toBe(
      new Date(2026, 9, 16).getTime(),
    );
    expect(parseGraphFilterQuery({ since: '2026-10-16T08:30:00.000Z' })?.since).toBe(
      Date.parse('2026-10-16T08:30:00.000Z'),
    );
    expect(parseGraphFilterQuery({ tag: ' ' })).toMatchObject({ tag: null });
    expect(() => parseGraphFilterQuery({ since: 'hôm qua' })).toThrow(/since/);
    expect(() => parseGraphFilterQuery({ since: '2026-02-30' })).toThrow(/since/);
  });
});
