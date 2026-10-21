import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '../../i18n';
import { summarySentence } from './today-summary';

const counts = (overdue: number, deadlinesThisWeek: number, openToday: number) => ({
  overdue,
  deadlinesThisWeek,
  openToday,
});

describe('Today summary sentence (F10)', () => {
  beforeEach(async () => {
    initI18n('vi');
    await i18n.changeLanguage('vi');
  });
  afterEach(async () => {
    await i18n.changeLanguage('vi');
  });

  it('Vietnamese: overdue first, then the week and today; else an invitation to write', () => {
    const t = i18n.t.bind(i18n);
    expect(summarySentence(counts(3, 2, 4), t)).toBe(
      'Có 3 việc quá hạn. Tuần này có 2 deadline. Hôm nay còn 4 việc.',
    );
    expect(summarySentence(counts(0, 2, 3), t)).toBe('Tuần này có 2 deadline. Hôm nay còn 3 việc.');
    expect(summarySentence(counts(1, 0, 0), t)).toBe('Có 1 việc quá hạn.');
    expect(summarySentence(counts(0, 0, 2), t)).toBe('Hôm nay còn 2 việc.');
    expect(summarySentence(counts(0, 0, 0), t)).toBe('Hôm nay không có gì gấp. Viết gì đó nhé?');
  });

  it('English, with singular and plural forms', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(summarySentence(counts(1, 1, 1), t)).toBe(
      'You have 1 overdue item. 1 deadline this week. 1 task left today.',
    );
    expect(summarySentence(counts(2, 3, 4), t)).toBe(
      'You have 2 overdue items. 3 deadlines this week. 4 tasks left today.',
    );
    expect(summarySentence(counts(0, 0, 0), t)).toBe(
      'Nothing urgent today. Feel like writing something?',
    );
  });
});
