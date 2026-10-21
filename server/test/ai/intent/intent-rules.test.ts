import { describe, expect, it } from 'vitest';
import { ruleIntent, topicsNamedIn } from '../../../src/ai/intent/intent-rules.js';

const WED = '2026-10-21'; // a Wednesday; its week is 19/10 (Mon) – 25/10 (Sun)

type Row = [
  question: string,
  today: string,
  kind: string,
  from: string | null,
  to: string | null,
  overdue: boolean,
];

const TABLE: Row[] = [
  // Vietnamese, with diacritics
  ['Tuần này có gì đến hạn?', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Hôm nay cần làm gì?', WED, 'tasks', WED, WED, true],
  ['Ngày mai có deadline nào không?', WED, 'deadlines', '2026-10-22', '2026-10-22', false],
  ['Tuần sau phải nộp gì?', WED, 'deadlines', '2026-10-26', '2026-11-01', false],
  ['Tuần tới có hạn gì không?', WED, 'deadlines', '2026-10-26', '2026-11-01', false],
  ['Tháng này có những hạn nào?', WED, 'deadlines', '2026-10-01', '2026-10-31', false],
  ['7 ngày tới có gì đến hạn', WED, 'deadlines', WED, '2026-10-28', false],
  ['Trong 10 ngày có gì phải nộp?', WED, 'deadlines', WED, '2026-10-31', false],
  ['Có việc gì quá hạn không?', WED, 'deadlines', null, null, true],
  ['Có deadline nào quá hạn không?', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Đồ án có hạn chót khi nào?', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Tuần này mình có gì?', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Việc tuần sau', WED, 'deadlines', '2026-10-26', '2026-11-01', false],
  ['Hôm nay và ngày mai có gì đến hạn?', WED, 'deadlines', WED, '2026-10-22', false],
  // typed without diacritics
  ['tuan nay co han gi', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['hom nay can lam gi', WED, 'tasks', WED, WED, true],
  // English
  ['What do I have due this week?', WED, 'deadlines', '2026-10-19', '2026-10-25', true],
  ['what is due tomorrow', WED, 'deadlines', '2026-10-22', '2026-10-22', false],
  ['deadlines in the next 3 days', WED, 'deadlines', WED, '2026-10-24', false],
  ['my tasks today', WED, 'tasks', WED, WED, true],
  ['What is overdue?', WED, 'deadlines', null, null, true],
  ['any deadlines next month?', WED, 'deadlines', '2026-11-01', '2026-11-30', false],
  // text questions (no deadline/task words; "hàn", "hạn chế" are not deadlines)
  ['Tóm tắt những gì mình học về đạo hàm', WED, 'text', null, null, false],
  ['Hàn Quốc có món gì ngon?', WED, 'text', null, null, false],
  ['Hạn chế của phương pháp này là gì?', WED, 'text', null, null, false],
  ['Explain eigenvalues', WED, 'text', null, null, false],
  // week boundaries: Monday and Sunday belong to their own week
  ['Tuần này có gì đến hạn?', '2026-10-19', 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Tuần này có gì đến hạn?', '2026-10-25', 'deadlines', '2026-10-19', '2026-10-25', true],
  ['Tuần sau có gì đến hạn?', '2026-10-25', 'deadlines', '2026-10-26', '2026-11-01', false],
  // month end
  ['Ngày mai có gì đến hạn?', '2026-10-31', 'deadlines', '2026-11-01', '2026-11-01', false],
  ['Tháng sau có gì đến hạn?', '2026-10-31', 'deadlines', '2026-11-01', '2026-11-30', false],
  ['this month deadlines', '2028-02-15', 'deadlines', '2028-02-01', '2028-02-29', false],
  // year end
  ['Ngày mai có gì đến hạn?', '2026-12-31', 'deadlines', '2027-01-01', '2027-01-01', false],
  ['Tuần này có gì đến hạn?', '2026-12-31', 'deadlines', '2026-12-28', '2027-01-03', true],
  ['Tuần sau có gì đến hạn?', '2026-12-31', 'deadlines', '2027-01-04', '2027-01-10', false],
  ['Tháng sau có gì đến hạn?', '2026-12-31', 'deadlines', '2027-01-01', '2027-01-31', false],
];

describe('intent rules fallback (no network)', () => {
  it.each(TABLE)(
    '%s (today %s) → %s %s…%s overdue=%s',
    (question, today, kind, from, to, overdue) => {
      const intent = ruleIntent(question, today);
      expect(intent).toMatchObject({ kind, from, to, overdue, source: 'rules' });
    },
  );

  it('names topics from the offered titles only, diacritics and case ignored', () => {
    const topics = ['Xác suất thống kê', 'Giải tích 1', 'Probability'];
    expect(topicsNamedIn('Tuần này môn xac suat thong ke có gì đến hạn?', topics)).toEqual([
      'Xác suất thống kê',
    ]);
    expect(ruleIntent('what do I have due this week for Probability?', WED, topics).about).toEqual([
      'Probability',
    ]);
    // A title must appear as whole words: "Giải tích 1" is not named by "giải tích 12".
    expect(topicsNamedIn('giải tích 12 có gì đến hạn', topics)).toEqual([]);
    expect(ruleIntent('Tóm tắt Giải tích 1', WED, topics).about).toEqual([]);
  });
});
