import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DeadlineItem } from '../../../src/index/index-types.js';
import { ask, createAiTestApp, listLines, type AiTestApp } from './ai-test-app.js';
import { createFakeAiRuntime } from './fake-ai-runtime.js';

const PORT = 47741;
const fm = (lines: string) => `---\n${lines}\n---\n\n`;
const task = (text: string, date: string, done = false) =>
  `- [${done ? 'x' : ' '}] ${text} 📅 ${date}${done ? ' ✅ 2026-10-19' : ''}`;

/** 25 open items due today (Mon 19/10) … Sunday 25/10, plus items that must never be listed. */
const FILES: Record<string, string> = {
  '2 Areas/Xác suất thống kê.md': `${fm('type: course')}# Xác suất\n\n${[
    task('Bài tập 1', '2026-10-19'),
    task('Bài tập 2', '2026-10-20'),
    task('Bài tập 3', '2026-10-21'),
    task('Bài tập 4', '2026-10-22'),
    task('Bài tập 5', '2026-10-24'),
    task('Bài tập 6', '2026-10-25'),
    task('Bài tuần sau', '2026-10-26'),
  ].join('\n')}\n`,
  '2 Areas/Giải tích 1.md': `${fm('type: course')}${[
    task('Đọc chương 2', '2026-10-19'),
    task('Đọc chương 3', '2026-10-21'),
    task('Đọc chương 4', '2026-10-23'),
    task('Đọc chương 5', '2026-10-25'),
    task('Đã nộp', '2026-10-20', true),
  ].join('\n')}\n`,
  'Kế hoạch.md': `${task('Gọi về nhà', '2026-10-20')}\n${task('Dọn phòng', '2026-10-24')}\n${task('Tháng sau', '2026-11-02')}\n`,
  'Daily/2026-10-19.md': `${fm('type: daily')}${task('Mua vở', '2026-10-19')}\n${task('Trả sách', '2026-10-22')}\n`,
  '0 Inbox/Ôn thi.md': `Ôn cho [[Xác suất thống kê]].\n\n${task('Làm đề cũ', '2026-10-21')}\n${task('Hỏi thầy', '2026-10-23')}\n`,
  '1 Projects/Đồ án GT.md': `${fm('type: project\nstatus: doing\ndeadline: 2026-10-25\ncourse: "[[Giải tích 1]]"')}${task('Viết báo cáo', '2026-10-22')}\n${task('Nộp bản nháp', '2026-10-20')}\n`,
  '1 Projects/Xong rồi.md': `${fm('type: project\nstatus: done\ndeadline: 2026-10-21')}${task('Việc cũ', '2026-10-21')}\n`,
  '4 Archive/Cũ.md': `${fm('type: course\ndeadline: 2026-10-22')}${task('Lưu trữ', '2026-10-23')}\n`,
  'Templates/Đồ án mẫu.md': `${fm('type: project\ndeadline: 2026-10-22')}${task('Mẫu', '2026-10-21')}\n`,
  '3 Resources/Đọc thêm.md': `${fm('type: course')}${task('Nguồn', '2026-10-21')}\n`,
  'wiki/Khái niệm.md': `${task('Wiki', '2026-10-21')}\n`,
};
for (let i = 1; i <= 3; i += 1) {
  FILES[`1 Projects/Đồ án XS ${i}.md`] =
    `${fm(`type: project\nstatus: doing\ndeadline: 2026-10-2${i}\ncourse: "[[Xác suất thống kê]]"`)}${task(`Phần ${i}`, `2026-10-2${i + 2}`)}\n`;
}

const XS_NOTES = new Set([
  '2 Areas/Xác suất thống kê.md',
  '0 Inbox/Ôn thi.md',
  '1 Projects/Đồ án XS 1.md',
  '1 Projects/Đồ án XS 2.md',
  '1 Projects/Đồ án XS 3.md',
]);

/**
 * The line the answer must hold for an item (each item linked exactly once); a task of a Daily
 * note names the note by its day.
 */
function expectedLine(item: DeadlineItem, language: 'vi' | 'en'): string {
  const target = item.path.slice(0, -3);
  if (item.kind === 'note') return `- [[${target}|${item.noteTitle}]]`;
  const day = /^Daily\/\d{4}-(\d{2})-(\d{2})\.md$/.exec(item.path);
  if (day) {
    const place =
      language === 'vi'
        ? `trong [[${target}|daily note ${day[2]}/${day[1]}]]`
        : `in the [[${target}|daily note of October ${Number(day[2])}]]`;
    return `- ${item.title} (${place})`;
  }
  return `- ${item.title} (${language === 'vi' ? 'trong' : 'in'} [[${target}|${item.noteTitle}]])`;
}

const intentJson = (about: string[] = [], from = '2026-10-19', to = '2026-10-25') =>
  JSON.stringify({ kind: 'deadlines', from, to, overdue: true, about });

describe('structured deadline answers through the API (F33.1)', () => {
  let a: AiTestApp;
  let thisWeek: DeadlineItem[];
  beforeAll(async () => {
    a = await createAiTestApp(PORT, {
      files: FILES,
      runtime: createFakeAiRuntime({
        replies: { intent: intentJson(), chat: ['Tuần này bạn có ', '25 việc cần chú ý.'] },
      }),
    });
    const view = a.t.context.deadlines.today();
    thisWeek = view.strip.days.filter((d) => d.date <= view.week.end).flatMap((d) => d.items);
  });
  afterAll(async () => a?.t.close());

  it('"Tuần này có gì đến hạn?" lists exactly Today\'s this-week items, each linked once', async () => {
    expect(thisWeek).toHaveLength(25);
    expect(a.t.context.deadlines.today().summary.deadlinesThisWeek).toBe(25);
    a.runtime.requests.length = 0;
    const reply = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
    expect(reply.response.statusCode).toBe(200);
    expect(reply.meta).toEqual({ kind: 'deadlines', retrieval: 'structured', sources: [] });
    const lines = listLines(reply.done.answer);
    expect(lines.sort()).toEqual(thisWeek.map((item) => expectedLine(item, 'vi')).sort());
    expect(
      reply.done.answer.startsWith(
        'Tuần này bạn có 25 việc cần chú ý.\n\n**Hôm nay, thứ hai 19/10**',
      ),
    ).toBe(true);
    expect(reply.done.answer).toContain('**Thứ tư 21/10 (còn 2 ngày)**');
    expect(reply.done.answer).not.toContain('Quá hạn');
    expect(reply.done.notices).toEqual([]);
    expect(reply.done.citations.map((c: { path: string }) => c.path).sort()).toEqual(
      [...new Set(thisWeek.map((i) => i.path))].sort(),
    );
    // Deltas are the streamed text: the model's introduction, then the list the server rendered.
    expect(reply.streamed).toBe(reply.done.answer);
  });

  it('the model only writes the introduction from counts: it never sees the items', async () => {
    const chat = a.runtime.requests.filter((r) => r.purpose === 'chat');
    expect(chat).toHaveLength(1);
    const sent = [chat[0]!.system, ...chat[0]!.messages.map((m) => m.content)].join('\n');
    expect(sent).toContain('Tổng số mục còn mở: 25');
    expect(sent).toContain('Không liệt kê');
    for (const item of thisWeek) expect(sent).not.toContain(item.title);
    expect(chat[0]!.maxTokens).toBeLessThanOrEqual(200);
  });

  it('the intent step offers in-scope course/project titles only', async () => {
    const intent = a.runtime.requests.find((r) => r.purpose === 'intent')!;
    const text = intent.messages[0]!.content;
    for (const title of ['Xác suất thống kê', 'Giải tích 1', 'Đồ án XS 1', 'Đồ án GT']) {
      expect(text).toContain(`- ${title}`);
    }
    for (const hidden of ['Cũ', 'Đồ án mẫu', 'Đọc thêm'])
      expect(text).not.toContain(`- ${hidden}\n`);
  });

  it('S5: "…due this week for Probability?" keeps that course\'s items (note, course:, links)', async () => {
    a.runtime.options.replies!.intent = intentJson(['Xác suất thống kê']);
    a.runtime.options.replies!.chat = 'You have 14 items for this course this week.';
    const reply = await ask(a.t, { question: 'what do I have due this week for Probability?' });
    const expected = thisWeek.filter((item) => XS_NOTES.has(item.path));
    expect(expected).toHaveLength(14);
    expect(listLines(reply.done.answer).sort()).toEqual(
      expected.map((i) => expectedLine(i, 'en')).sort(),
    );
    // English dates in the app's long English format.
    expect(reply.done.answer).toContain('**Today, Monday, October 19**');
    expect(reply.done.answer).toContain('**Thursday, October 22 (in 3 days)**');
  });

  it('a range without items answers with a fixed sentence and no answer call', async () => {
    a.runtime.options.replies!.intent = intentJson([], '2026-12-01', '2026-12-07');
    a.runtime.requests.length = 0;
    const reply = await ask(a.t, { question: 'Tuần đầu tháng 12 có gì đến hạn?' });
    expect(reply.done.answer).toBe('Không có deadline nào còn mở từ 01/12 đến 07/12.');
    expect(reply.done.notices).toEqual(['no-items']);
    expect(a.runtime.requests.map((r) => r.purpose)).toEqual(['intent']);
  });

  it('items in folders outside the scope are left out and counted', async () => {
    a.runtime.options.replies!.intent = intentJson();
    a.runtime.options.folders = ['', '0 Inbox', '2 Areas', 'Daily'];
    a.runtime.requests.length = 0;
    try {
      const reply = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
      const shown = thisWeek.filter((i) => !i.path.startsWith('1 Projects/'));
      expect(listLines(reply.done.answer).sort()).toEqual(
        shown.map((i) => expectedLine(i, 'vi')).sort(),
      );
      expect(reply.done.notices).toEqual(['out-of-scope-hidden']);
      expect(reply.done.answer).toContain(
        `*Có ${25 - shown.length} mục trong thư mục ngoài phạm vi AI`,
      );
      for (const text of a.runtime.sentTexts()) expect(text).not.toContain('Đồ án');
    } finally {
      a.runtime.options.folders = null;
    }
  });

  it("overdue items get their own group; task questions list Today's open tasks", async () => {
    await a.t.call('POST', '/api/note', {
      path: '0 Inbox/Trễ.md',
      content: `${task('Nộp phiếu', '2026-10-16')}\n`,
    });
    a.runtime.options.replies!.intent = 'not json'; // the rules decide
    const overdue = await ask(a.t, { question: 'Có gì quá hạn không?' });
    expect(overdue.done.answer).toContain(
      '**Quá hạn**\n- Nộp phiếu (trong [[0 Inbox/Trễ|Trễ]], 16/10, quá hạn 3 ngày)',
    );
    expect(listLines(overdue.done.answer)).toHaveLength(1);

    const week = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
    expect(listLines(week.done.answer)).toHaveLength(26);
    expect(week.done.answer.indexOf('**Quá hạn**')).toBeLessThan(
      week.done.answer.indexOf('**Hôm nay'),
    );

    const tasks = await ask(a.t, { question: 'Hôm nay cần làm gì?' });
    const open = a.t.context.deadlines.today().todayTasks.filter((x) => !x.done);
    expect(tasks.meta.kind).toBe('tasks');
    expect(listLines(tasks.done.answer)).toHaveLength(open.length);
  });
});
