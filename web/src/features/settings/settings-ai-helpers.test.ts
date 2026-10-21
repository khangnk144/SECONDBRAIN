import { describe, expect, it } from 'vitest';
import { parseMonthlyLimit } from './ai-budget-field';
import {
  aiScopeChoices,
  effectiveAiFolders,
  excludedLeftOut,
  toggledAiFolders,
} from './ai-scope-folders';
import { maskBearerTokens } from './copy-text';
import { embeddingErrorKey } from './embeddings-state';
import { formatTokens, nextMonthLabel, parseTokenCount } from './settings-format';

const TOP = [
  '0 Inbox',
  '1 Projects',
  '2 Areas',
  '3 Resources',
  '4 Archive',
  'Attachments',
  'Daily',
  'Templates',
  'wiki',
];

describe('Settings AI helpers', () => {
  it('folder scope mirrors the server: root notes, no never-sent folders, sources and archive out', () => {
    expect(aiScopeChoices(TOP)).toEqual([
      '',
      '0 Inbox',
      '1 Projects',
      '2 Areas',
      '3 Resources',
      '4 Archive',
      'Daily',
      'wiki',
    ]);
    expect(effectiveAiFolders(null, TOP)).toEqual([
      '',
      '0 Inbox',
      '1 Projects',
      '2 Areas',
      'Daily',
      'wiki',
    ]);
    expect(effectiveAiFolders(['wiki'], TOP)).toEqual(['wiki']);
    const choices = aiScopeChoices(TOP);
    // Box order is kept, a deeper folder stored by other means is not lost, case is ignored.
    expect(toggledAiFolders(['wiki', '1 Projects/Đồ án', ''], choices, '0 inbox', true)).toEqual([
      '',
      '0 Inbox',
      'wiki',
      '1 Projects/Đồ án',
    ]);
    expect(toggledAiFolders(['', 'wiki'], choices, '', false)).toEqual(['wiki']);
    expect(excludedLeftOut(['', '3 resources'])).toEqual(['4 Archive']);
  });

  it('a hidden top folder (.trash) is a choice but never in the default scope, like the server', () => {
    const withHidden = ['.trash', ...TOP];
    expect(aiScopeChoices(withHidden)).toContain('.trash');
    expect(effectiveAiFolders(null, withHidden)).toEqual(effectiveAiFolders(null, TOP));
    expect(effectiveAiFolders(['.trash'], withHidden)).toEqual(['.trash']);
  });

  it('token counts: typed with or without group separators, within the server range', () => {
    expect(parseTokenCount('2.000.000')).toBe(2_000_000);
    expect(parseTokenCount('2,000,000')).toBe(2_000_000);
    expect(parseTokenCount('2 000 000')).toBe(2_000_000);
    expect(parseTokenCount('2000000')).toBe(2_000_000);
    expect(parseTokenCount('12,5')).toBeNull();
    expect(parseTokenCount('1e6')).toBeNull();
    expect(parseTokenCount('-5')).toBeNull();
    expect(parseMonthlyLimit('9999')).toBeNull();
    expect(parseMonthlyLimit('10.000')).toBe(10_000);
    expect(parseMonthlyLimit('100.000.001')).toBeNull();
    expect(formatTokens(1530, 'vi')).toBe('1.530');
    expect(formatTokens(1530, 'en')).toBe('1,530');
    expect(nextMonthLabel('2026-12', 'vi')).toBe('tháng 1 năm 2027');
    expect(nextMonthLabel('2026-10', 'en')).toBe('November 2026');
  });

  it('masks every bearer token down to its last 4 characters', () => {
    const snippet = '{ "Authorization": "Bearer abcDEF123-_xyz9" }';
    expect(maskBearerTokens(snippet)).toBe('{ "Authorization": "Bearer ••••xyz9" }');
    expect(maskBearerTokens('no token here')).toBe('no token here');
  });

  it('names known provider errors and falls back for the rest', () => {
    expect(embeddingErrorKey('auth')).toBe('auth');
    expect(embeddingErrorKey('bad-request')).toBe('malformed');
    expect(embeddingErrorKey('EIO')).toBe('generic');
    expect(embeddingErrorKey(null)).toBe('generic');
  });
});
