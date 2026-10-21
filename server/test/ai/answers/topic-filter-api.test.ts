import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { containsWords } from '../../../src/ai/answers/topic-relations.js';
import { buildSampleDataSet } from '../../../src/sample-data/sample-data-set.js';
import { ask, createAiTestApp, listLines, type AiTestApp } from './ai-test-app.js';
import { createFakeAiRuntime } from './fake-ai-runtime.js';

const fm = (lines: string) => `---\n${lines}\n---\n\n`;
const intent = (about: string[], from: string | null, to: string | null, overdue: boolean) =>
  JSON.stringify({ kind: 'deadlines', from, to, overdue, about });

/** Monday 19/10/2026. The Daily task names its course in plain words, as she writes. */
const FILES: Record<string, string> = {
  '2 Areas/Xác suất thống kê.md': `${fm('type: course')}# Xác suất thống kê\n\nHọc thứ Ba.\n`,
  '2 Areas/Giải tích 1.md': `${fm('type: course')}# Giải tích 1\n`,
  'Daily/2026-10-19.md': `${fm('type: daily')}## Hôm nay\n\n- [ ] Nộp bài tập Xác suất thống kê 📅 2026-10-19\n- [ ] Ôn lại công thức Bayes\n`,
  'Daily/2026-10-18.md': `${fm('type: daily')}- [ ] Trả sách 📅 2026-10-17\n- [ ] Gửi email hỏi thầy 📅 2026-10-18\n`,
  'Kế hoạch.md':
    '- [ ] ôn thi XAC SUAT THONG KE 📅 2026-10-23\n- [ ] Đọc Giải tích 12 📅 2026-10-21\n',
  '1 Projects/Đồ án Giải tích.md': `${fm('type: project\nstatus: doing\ncourse: "[[Giải tích 1]]"')}- [ ] Viết bản nháp 📅 2026-10-24\n`,
};

const DAILY_TASK = '- Nộp bài tập Xác suất thống kê (trong [[Daily/2026-10-19|daily note 19/10]])';

describe('S5 topic filter: plain words, whole words, and the full list when nothing matches (F33.1)', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    a = await createAiTestApp(47610, {
      files: FILES,
      runtime: createFakeAiRuntime({ replies: { chat: 'Tuần này môn này có 2 việc.' } }),
    });
  });
  afterAll(async () => a?.t.close());

  it('a task naming the course in plain words (any case, no diacritics) belongs to it', async () => {
    a.runtime.options.replies!.intent = intent(
      ['Xác suất thống kê'],
      '2026-10-19',
      '2026-10-25',
      true,
    );
    const reply = await ask(a.t, { question: 'Tuần này môn Xác suất thống kê có gì đến hạn?' });
    expect(listLines(reply.done.answer)).toEqual([
      DAILY_TASK,
      '- ôn thi XAC SUAT THONG KE (trong [[Kế hoạch|Kế hoạch]])',
    ]);
    expect(reply.done.answer.startsWith('Tuần này môn này có 2 việc.\n\n')).toBe(true);
    expect(reply.done.notices).toEqual([]);
  });

  it('whole words only: "Giải tích 12" is not "Giải tích 1"; course: still counts', async () => {
    expect(containsWords('doc giai tich 12', 'giai tich 1')).toBe(false);
    expect(containsWords('nop [[xac suat thong ke]]', 'xac suat thong ke')).toBe(true);
    a.runtime.options.replies!.intent = intent(['Giải tích 1'], '2026-10-19', '2026-10-25', true);
    const reply = await ask(a.t, { question: 'Tuần này môn Giải tích 1 có gì?' });
    expect(listLines(reply.done.answer)).toEqual([
      '- Viết bản nháp (trong [[1 Projects/Đồ án Giải tích|Đồ án Giải tích]])',
    ]);
  });

  it('none of the open items belongs to the topic: says so and lists all of them, no intro', async () => {
    a.runtime.options.replies!.intent = intent(['Giải tích 1'], '2026-10-19', '2026-10-23', false);
    a.runtime.requests.length = 0;
    const reply = await ask(a.t, { question: 'Từ nay đến thứ sáu môn Giải tích 1 có gì?' });
    expect(reply.done.answer).toBe(
      [
        'Không thấy việc nào gắn với Giải tích 1. Đây là 3 việc trong khoảng này:',
        '',
        '**Hôm nay, thứ hai 19/10**',
        DAILY_TASK,
        '',
        '**Thứ tư 21/10 (còn 2 ngày)**',
        '- Đọc Giải tích 12 (trong [[Kế hoạch|Kế hoạch]])',
        '',
        '**Thứ sáu 23/10 (còn 4 ngày)**',
        '- ôn thi XAC SUAT THONG KE (trong [[Kế hoạch|Kế hoạch]])',
      ].join('\n'),
    );
    expect(reply.streamed).toBe(reply.done.answer);
    expect(reply.done.notices).toEqual([]);
    expect(reply.done.citations.map((c: { path: string }) => c.path)).toEqual([
      'Daily/2026-10-19.md',
      'Kế hoạch.md',
    ]);
    expect(a.runtime.requests.map((r) => r.purpose)).toEqual(['intent']);

    // Typed without diacritics, so the question reads as English.
    const english = await ask(a.t, { question: 'What is due until Friday for Giai tich 1?' });
    expect(english.done.answer).toContain(
      'Nothing found linked to Giải tích 1. Here are the 3 items in this range:\n\n**Today, Monday, October 19**\n- Nộp bài tập Xác suất thống kê (in the [[Daily/2026-10-19|daily note of October 19]])',
    );
    expect(english.done.answer).toContain('**Wednesday, October 21 (in 2 days)**');
  });

  it('nothing at all in the range: the fixed sentence with notice no-items', async () => {
    a.runtime.options.replies!.intent = intent(
      ['Xác suất thống kê'],
      '2026-12-01',
      '2026-12-07',
      false,
    );
    const reply = await ask(a.t, { question: 'Tuần đầu tháng 12 môn Xác suất thống kê có gì?' });
    expect(reply.done.answer).toBe(
      'Không có deadline nào còn mở cho Xác suất thống kê từ 01/12 đến 07/12.',
    );
    expect(reply.done.notices).toEqual(['no-items']);
  });

  it('Daily-note rows name the note by its day; the date only when it differs (L8)', async () => {
    a.runtime.options.replies!.intent = intent([], null, null, true);
    const vi = await ask(a.t, { question: 'Có gì quá hạn không?' });
    expect(listLines(vi.done.answer)).toEqual([
      '- Trả sách (trong [[Daily/2026-10-18|daily note 18/10]], 17/10, quá hạn 2 ngày)',
      '- Gửi email hỏi thầy (trong [[Daily/2026-10-18|daily note 18/10]], quá hạn 1 ngày)',
    ]);
    const en = await ask(a.t, { question: 'What is overdue?' });
    expect(listLines(en.done.answer)).toEqual([
      '- Trả sách (in the [[Daily/2026-10-18|daily note of October 18]], October 17, 2 days overdue)',
      '- Gửi email hỏi thầy (in the [[Daily/2026-10-18|daily note of October 18]], 1 day overdue)',
    ]);
  });
});

describe('S5 on the sample data: "…môn Xác suất thống kê có gì đến hạn?" (F33.1)', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    const files: Record<string, string> = {};
    for (const file of buildSampleDataSet('2026-10-19')) {
      if (typeof file.content === 'string') files[file.path] = file.content;
    }
    a = await createAiTestApp(47611, {
      files,
      runtime: createFakeAiRuntime({
        replies: {
          intent: intent(['Xác suất thống kê'], '2026-10-19', '2026-10-25', true),
          chat: 'Môn này có 1 việc tuần này.',
        },
      }),
    });
  });
  afterAll(async () => a?.t.close());

  it('lists the Daily homework Today shows (course named in plain words), one link per row', async () => {
    const today = a.t.context.deadlines.today();
    expect(today.todayTasks.map((task) => task.title)).toContain('Nộp bài tập Xác suất thống kê');
    const reply = await ask(a.t, { question: 'Tuần này môn Xác suất thống kê có gì đến hạn?' });
    expect(listLines(reply.done.answer)).toEqual([DAILY_TASK]);
    expect(reply.done.notices).toEqual([]);
  });
});
