import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, createAiTestApp, type AiTestApp } from './ai-test-app.js';
import { createFakeAiRuntime } from './fake-ai-runtime.js';

/** Every out-of-scope note carries the marker in its title, text and tags. */
const MARKER = 'zxq';
const FILES = {
  '2 Areas/Xác suất.md':
    '---\ntype: course\n---\n\nPhân phối chuẩn và kỳ vọng. #thống-kê\n- [ ] Nộp bài 📅 2026-10-19\n',
  '0 Inbox/Ý tưởng.md': 'Phân phối chuẩn cho đồ án.\n',
  '3 Resources/Zxq nguồn.md': '---\ntype: course\n---\n\nPhân phối chuẩn zxq nguồn. #zxq-nguon\n',
  '4 Archive/Zxq cũ.md':
    '---\ntype: course\ndeadline: 2026-10-20\n---\n\nPhân phối chuẩn zxq cũ. #zxq-cu\n',
  'Riêng tư/Zxq riêng.md':
    '---\ntype: course\ndeadline: 2026-10-19\n---\n\nPhân phối chuẩn zxq riêng. #zxq-rieng\n- [ ] Việc zxq 📅 2026-10-19\n',
  'Templates/Zxq mẫu.md': '---\ntype: course\n---\n\nPhân phối chuẩn zxq mẫu. #zxq-mau\n',
};
/** A custom scope: `Riêng tư` is left out, as are 3 Resources and 4 Archive. */
const SCOPE = ['', '0 Inbox', '1 Projects', '2 Areas', 'Daily', 'wiki'];

describe('only in-scope content leaves the machine (F33.3, F33.4 request mock)', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    a = await createAiTestApp(47747, {
      files: FILES,
      runtime: createFakeAiRuntime({
        folders: SCOPE,
        replies: {
          intent: (request) =>
            request.messages[0]!.content.includes('đến hạn')
              ? '{"kind":"deadlines","from":"2026-10-19","to":"2026-10-25","overdue":true,"about":[]}'
              : '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}',
          chat: 'Trả lời [S1].',
          action: (request) =>
            request.system.includes('"links"')
              ? '{"links":[{"id":"C1","reason":"x"}]}'
              : request.system.includes('"tags"')
                ? '{"tags":["thống-kê"]}'
                : request.system.includes('"folder"')
                  ? '{"folder":"2 Areas","title":"Ý tưởng","reason":"x","keep":false}'
                  : 'Kết quả.',
          today: 'Hôm nay bạn có 1 việc.',
        },
      }),
    });
  });
  afterAll(async () => a?.t.close());

  it('chat, every action and the Today line never send an out-of-scope title, text or tag', async () => {
    const text = await ask(a.t, { question: 'Tóm tắt phân phối chuẩn' });
    expect(text.meta.sources.map((s: { path: string }) => s.path).sort()).toEqual([
      '0 Inbox/Ý tưởng.md',
      '2 Areas/Xác suất.md',
    ]);
    const deadlines = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
    expect(deadlines.done.notices).toContain('out-of-scope-hidden');
    expect(deadlines.done.answer).not.toContain('Zxq');
    const selection = 'Phân phối chuẩn và kỳ vọng';
    for (const action of ['summarize', 'improve', 'explain', 'suggest-links', 'suggest-tags']) {
      const res = await a.t.call('POST', '/api/ai/action', {
        action,
        text: selection,
        path: '0 Inbox/Ý tưởng.md',
      });
      expect(res.statusCode, `${action}: ${res.body}`).toBe(200);
    }
    const placement = await a.t.call('POST', '/api/ai/action', {
      action: 'suggest-placement',
      path: '0 Inbox/Ý tưởng.md',
    });
    expect(placement.statusCode, placement.body).toBe(200);
    expect((await a.t.call('POST', '/api/ai/today-summary')).json().text).toBe(
      'Hôm nay bạn có 1 việc.',
    );

    const purposes = new Set(a.runtime.requests.map((r) => r.purpose));
    expect([...purposes].sort()).toEqual(['action', 'chat', 'intent', 'today']);
    expect(a.runtime.requests.length).toBeGreaterThanOrEqual(11);
    for (const sent of a.runtime.sentTexts()) {
      expect(sent.toLowerCase()).not.toContain(MARKER);
      expect(sent).not.toMatch(/Riêng tư|3 Resources\/|4 Archive\/|Templates\//);
    }
  });

  it('an action on an out-of-scope note is refused before anything is sent', async () => {
    const before = a.runtime.requests.length;
    for (const path of [
      'Riêng tư/Zxq riêng.md',
      '3 Resources/Zxq nguồn.md',
      'Templates/Zxq mẫu.md',
    ]) {
      const res = await a.t.call('POST', '/api/ai/action', {
        action: 'summarize',
        text: 'x',
        path,
      });
      expect(res.json().error).toMatchObject({
        code: 'VALIDATION',
        details: { reason: 'out-of-scope' },
      });
    }
    expect(a.runtime.requests.length).toBe(before);
  });
});
