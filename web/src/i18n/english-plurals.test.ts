import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from './index';

// Counts in English sentences take the singular for 1 ("1 line", not "1 lines"); Vietnamese has
// one form, so the same keys read the same there.
describe('counted words in English', () => {
  beforeAll(() => {
    initI18n('vi');
  });
  const en = () => i18n.getFixedT('en');
  const vi = () => i18n.getFixedT('vi');

  it('history and conflict diff summaries', () => {
    const summary = (scope: 'history' | 'conflict', added: number, removed: number) =>
      en()(`${scope}.diff.summary`, {
        added: en()(`${scope}.diff.summaryAdded`, { count: added }),
        removed: en()(`${scope}.diff.summaryRemoved`, { count: removed }),
      });
    expect(summary('history', 0, 1)).toBe(
      'If you restore: 0 lines come back (+), 1 line goes (−).',
    );
    expect(summary('history', 1, 3)).toBe('If you restore: 1 line comes back (+), 3 lines go (−).');
    expect(summary('conflict', 1, 2)).toBe('1 line only in yours (+), 2 lines only on disk (−).');
    expect(
      vi()('history.diff.summary', {
        added: vi()('history.diff.summaryAdded', { count: 1 }),
        removed: vi()('history.diff.summaryRemoved', { count: 1 }),
      }),
    ).toBe('Nếu khôi phục: 1 dòng trở lại (+), 1 dòng mất đi (−).');
  });

  it('page field, rebuild progress, unfinished operations, project progress', () => {
    expect(en()('viewer.pdf.pageInput', { count: 1 })).toBe('Page number, of 1 page');
    expect(en()('viewer.pdf.pageInput', { count: 12 })).toBe('Page number, of 12 pages');
    expect(en()('settings.vault.rebuildProgress', { done: 0, count: 1 })).toBe(
      'Rebuilding the index: 0/1 file.',
    );
    expect(en()('journal.pendingGeneric', { done: 1, count: 2 })).toBe(
      'An operation did not finish (1/2 files).',
    );
    expect(en()('today.projects.progress', { done: 1, count: 1 })).toBe('1/1 task');
    expect(vi()('today.projects.progress', { done: 3, count: 5 })).toBe('3/5 việc');
  });
});
