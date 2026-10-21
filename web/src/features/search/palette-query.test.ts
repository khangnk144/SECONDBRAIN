import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '../../i18n';
import { filterSuggestions } from './filter-suggestions';
import { activeFilterToken, commandText, completeFilter, hasFilter } from './palette-query';
import { folderPaths } from './use-filter-values';

describe('palette query reading (F8.3)', () => {
  it('`>` switches to commands, with the text after it', () => {
    expect(commandText('>')).toBe('');
    expect(commandText('  > mở lịch ')).toBe('mở lịch');
    expect(commandText('a > b')).toBeNull();
    expect(hasFilter('giải tích tag:x')).toBe(true);
    expect(hasFilter('tagline: x')).toBe(false);
  });

  it('finds the filter still being typed at the end, quoted values included', () => {
    expect(activeFilterToken('tag:')).toEqual({ key: 'tag', value: '', start: 0 });
    expect(activeFilterToken('giải tích TAG:đồ')).toEqual({ key: 'tag', value: 'đồ', start: 10 });
    expect(activeFilterToken('folder:"1 Pro')).toEqual({ key: 'folder', value: '1 Pro', start: 0 });
    expect(activeFilterToken('folder:"1 Projects" ')).toBeNull();
    expect(activeFilterToken('folder:"1 Projects" due:')).toEqual({
      key: 'due',
      value: '',
      start: 20,
    });
    expect(activeFilterToken('tag:x ')).toBeNull();
    expect(activeFilterToken('newton')).toBeNull();
  });

  it('completes the token, quoting a value with spaces', () => {
    const query = 'đồ án folder:"1 Pr';
    const token = activeFilterToken(query);
    expect(token).not.toBeNull();
    if (!token) return;
    expect(completeFilter(query, token, '1 Projects')).toBe('đồ án folder:"1 Projects" ');
    const tag = activeFilterToken('tag:do');
    if (tag) expect(completeFilter('tag:do', tag, 'đồ-án')).toBe('tag:đồ-án ');
  });
});

describe('filter value suggestions (F8.3)', () => {
  beforeAll(async () => {
    initI18n('vi');
    await i18n.changeLanguage('vi');
  });
  const sources = {
    tags: [
      { tag: 'đồ-án', norm: 'do-an', count: 3 },
      { tag: 'giải-tích', norm: 'giai-tich', count: 1 },
      { tag: 'môn/đồ-họa', norm: 'mon/do-hoa', count: 2 },
    ],
    folders: ['0 Inbox', '1 Projects', '1 Projects/Đồ án Giải tích'],
  };
  const suggest = (query: string) => {
    const token = activeFilterToken(query);
    if (!token) throw new Error(`no token in ${query}`);
    return filterSuggestions(token, sources, i18n.t).map((s) => `${s.value}|${s.detail ?? ''}`);
  };

  it('tags start-matches first, then containing, diacritics and # ignored', () => {
    expect(suggest('tag:do')).toEqual(['đồ-án|3 ghi chú', 'môn/đồ-họa|2 ghi chú']);
    expect(suggest('tag:#GIAI')).toEqual(['giải-tích|1 ghi chú']);
    expect(suggest('tag:')).toHaveLength(3);
    // Typed in full (or pre-filled from a tag pill): nothing left to suggest.
    expect(suggest('tag:Đồ-án')).toEqual([]);
    expect(suggest('due:7d')).toEqual([]);
  });

  it('folders from the tree, fixed lists for type, due and class (with their meaning)', () => {
    expect(suggest('folder:"do an')).toEqual(['1 Projects/Đồ án Giải tích|']);
    expect(suggest('type:du')).toEqual(['project|Dự án']);
    expect(suggest('due:')).toEqual([
      '7d|hạn trong 7 ngày tới',
      '30d|hạn trong 30 ngày tới',
      'overdue|đã quá hạn',
    ]);
    expect(suggest('class:a')).toEqual(['archive|gồm cả ghi chú trong Archive']);
  });

  it('lists every folder at any depth, without Templates and Attachments', () => {
    const folder = (path: string, folders: unknown[] = []) => ({
      path,
      name: path.split('/').pop() ?? '',
      noteCount: 0,
      urgent: false,
      folders,
      files: [],
    });
    const tree = {
      inboxCount: 0,
      root: folder('', [
        folder('0 Inbox'),
        folder('1 Projects', [folder('1 Projects/Web bán hàng')]),
        folder('Templates'),
        folder('Attachments'),
      ]),
    } as Parameters<typeof folderPaths>[0];
    expect(folderPaths(tree)).toEqual(['0 Inbox', '1 Projects', '1 Projects/Web bán hàng']);
    expect(folderPaths(null)).toEqual([]);
  });
});
