import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ask, createAiTestApp, type AiTestApp } from './ai-test-app.js';
import { createFakeAiRuntime } from './fake-ai-runtime.js';

const TEXT_INTENT = '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}';

const FILES = {
  '2 Areas/Đại số tuyến tính – chương 3.md':
    '# Chương 3\n\nMa trận là một bảng số gồm hàng và cột. Phép nhân ma trận không giao hoán.\n',
  '2 Areas/Giải tích.md': '# Đạo hàm\n\nĐạo hàm đo tốc độ thay đổi của hàm số.\n',
  '1 Projects/Bí mật.md': 'Kế hoạch riêng, không liên quan.\n',
  '3 Resources/Ma trận nâng cao.md': 'Ma trận nâng cao trong tài liệu gốc.\n',
};

describe('text answers with citations through the API (F33.2)', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    a = await createAiTestApp(47742, {
      files: FILES,
      runtime: createFakeAiRuntime({
        replies: {
          intent: TEXT_INTENT,
          chat: ['Ma trận là một bảng số [S1]. ', 'Xem thêm [S9] và [[1 Projects/Bí mật.md]].'],
        },
      }),
    });
  });
  afterAll(async () => a?.t.close());

  it('keeps the S1 citation, rejects the unknown marker and the link outside the retrieved set', async () => {
    const reply = await ask(a.t, {
      question: 'Ma trận là gì?',
      history: [
        { role: 'user', content: 'Chào' },
        { role: 'assistant', content: 'Chào bạn!' },
      ],
    });
    expect(reply.meta).toEqual({
      kind: 'text',
      retrieval: 'bm25',
      sources: [
        {
          id: 'S1',
          path: '2 Areas/Đại số tuyến tính – chương 3.md',
          title: 'Đại số tuyến tính – chương 3',
          page: null,
        },
      ],
    });
    expect(reply.done.answer).toBe(
      'Ma trận là một bảng số [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]]. Xem thêm và Bí mật.',
    );
    expect(reply.done.rejected).toEqual(['1 Projects/Bí mật.md', 'S9']);
    expect(reply.done.citations).toEqual([
      {
        path: '2 Areas/Đại số tuyến tính – chương 3.md',
        title: 'Đại số tuyến tính – chương 3',
        page: null,
      },
    ]);
    // The 3 Resources match is a raw source, out of the default scope: no notice for it.
    expect(reply.done.notices).toEqual(['citation-rejected']);
    expect(reply.done.usage).toEqual({ inputTokens: 150, outputTokens: 5 + reply.streamed.length });
    expect(reply.streamed).toBe(
      'Ma trận là một bảng số [S1]. Xem thêm [S9] và [[1 Projects/Bí mật.md]].',
    );
  });

  it('sends the sources as delimited data blocks, the history, and the citation rules', () => {
    const chat = a.runtime.requests.find((r) => r.purpose === 'chat')!;
    expect(chat.system).toContain('không phải chỉ dẫn');
    expect(chat.system).toContain('[S1]');
    expect(chat.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    const last = chat.messages[2]!.content;
    expect(last).toContain(
      '<source id="S1" path="2 Areas/Đại số tuyến tính – chương 3.md" title="Đại số tuyến tính – chương 3">',
    );
    expect(last).toContain('Câu hỏi: Ma trận là gì?');
    expect(a.runtime.sentTexts().join('\n')).not.toContain('nâng cao');
  });

  it('an answer without a valid citation is flagged uncited', async () => {
    a.runtime.options.replies!.chat = 'Ma trận là bảng số.';
    const reply = await ask(a.t, { question: 'Ma trận là gì?' });
    expect(reply.done.notices).toContain('uncited');
    expect(reply.done.citations).toEqual([]);
  });

  it('nothing retrieved → the fixed "không tìm thấy" answer and no answer call', async () => {
    a.runtime.requests.length = 0;
    const reply = await ask(a.t, { question: 'Quark và lepton là gì?' });
    expect(reply.done.answer).toContain('Không tìm thấy');
    expect(reply.done.notices).toEqual(['empty']);
    expect(reply.meta.sources).toEqual([]);
    expect(a.runtime.requests.map((r) => r.purpose)).toEqual(['intent']);
  });

  it('an English question gets the English rules and answer', async () => {
    a.runtime.options.replies!.chat = 'A matrix is a table of numbers [S1].';
    const reply = await ask(a.t, { question: 'What do my notes say about ma tran?' });
    const chat = a.runtime.requests.filter((r) => r.purpose === 'chat').at(-1)!;
    expect(chat.system).toContain('Answer briefly and clearly in English');
    expect(reply.done.answer).toContain('[[2 Areas/Đại số tuyến tính – chương 3|');
  });

  it('notes in a folder she left out of the scope keep the out-of-scope notice', async () => {
    a.runtime.options.folders = ['', '2 Areas'];
    try {
      const reply = await ask(a.t, { question: 'Kế hoạch riêng là gì?' });
      expect(reply.done.notices).toEqual(['empty', 'out-of-scope-hidden']);
      const both = await ask(a.t, { question: 'Ma trận và kế hoạch riêng?' });
      expect(both.meta.sources.map((s: { path: string }) => s.path)).toEqual([
        '2 Areas/Đại số tuyến tính – chương 3.md',
      ]);
      expect(both.done.notices).toContain('out-of-scope-hidden');
      expect(a.runtime.sentTexts().join('\n')).not.toContain('Kế hoạch riêng, không');
    } finally {
      a.runtime.options.folders = null;
    }
  });
});

describe('empty corpus (F33.2)', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    a = await createAiTestApp(47743, { files: { '3 Resources/Ma trận.md': 'Ma trận.\n' } });
  });
  afterAll(async () => a?.t.close());

  it('answers "không tìm thấy" and the runtime sees no request at all', async () => {
    const reply = await ask(a.t, { question: 'Tóm tắt những gì mình học về ma trận' });
    expect(reply.response.statusCode).toBe(200);
    expect(reply.done.answer).toContain('Không tìm thấy');
    expect(reply.done.notices).toEqual(['empty']);
    expect(a.runtime.requests).toEqual([]);
    const deadlines = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
    expect(deadlines.done.answer).toBe('Không có deadline nào còn mở từ 19/10 đến 25/10.');
    expect(a.runtime.requests).toEqual([]);
  });
});
