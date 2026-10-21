import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError, type EmbeddingIndex } from '../../src/ai/ai-types.js';
import { ask, createAiTestApp, parseSse, type AiTestApp } from '../ai/answers/ai-test-app.js';
import { createFakeAiRuntime } from '../ai/answers/fake-ai-runtime.js';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createMemoryLogger, waitUntil } from './vault-test-app.js';

const PORT = 47740;
const TEXT_INTENT = '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}';
const FILES = {
  '2 Areas/Đại số tuyến tính – chương 3.md':
    '# Ma trận\n\nMa trận vuông, định thức và trị riêng.\n',
  '2 Areas/Giải tích.md': 'Đạo hàm và tích phân.\n',
  '4 Archive/Ma trận cũ.md': 'Ma trận cũ.\n',
};

/** Every AI route with a plausible request (security matrix). */
const ROUTES = [
  { method: 'POST', url: '/api/ai/chat', payload: { question: 'Ma trận là gì?' } },
  { method: 'POST', url: '/api/ai/action', payload: { action: 'summarize', text: 'x' } },
  { method: 'GET', url: '/api/ai/today-summary' },
  { method: 'POST', url: '/api/ai/today-summary', payload: {} },
  {
    method: 'POST',
    url: '/api/ai/save-answer',
    payload: { question: 'q', answer: 'a', folder: '2 Areas' },
  },
  { method: 'POST', url: '/api/ai/search', payload: { q: 'ma trận' } },
] as const;

describe('AI API: SSE chat, errors, security (SPEC §9)', () => {
  let a: AiTestApp;
  const logger = createMemoryLogger();
  beforeAll(async () => {
    a = await createAiTestApp(PORT, {
      files: FILES,
      listen: true,
      logger,
      runtime: createFakeAiRuntime({
        replies: { intent: TEXT_INTENT, chat: ['Ma trận ', 'vuông có định thức ', '[S1].'] },
      }),
    });
  });
  afterAll(async () => a?.t.close());

  it('streams meta, deltas and done as server-sent events with the baseline headers', async () => {
    const reply = await ask(a.t, { question: 'Ma trận là gì?' });
    expect(reply.response.statusCode).toBe(200);
    expect(reply.response.headers).toMatchObject({
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
    });
    expect(reply.events.map((e) => e.event)).toEqual(['meta', 'delta', 'delta', 'delta', 'done']);
    expect(reply.streamed).toBe('Ma trận vuông có định thức [S1].');
    expect(reply.done.answer).toBe(
      'Ma trận vuông có định thức [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]].',
    );
    expect(reply.done.notices).toEqual(['out-of-scope-hidden']);
    // The log line has the route, outcome and counts: no question, answer, title or path.
    const line = logger.lines.find((l) => l.includes('AI chat'))!;
    expect(line).toMatch(/^INFO AI chat ok kind=text retrieval=bm25 sources=1 citations=1 \d+ms$/);
    expect(logger.lines.join('\n')).not.toMatch(/Ma trận|Đại số|2 Areas/);
  });

  it.each([
    ['an empty question', { question: '   ' }],
    ['a question over 4000 characters', { question: 'x'.repeat(4001) }],
    ['an unknown field', { question: 'x', stream: false }],
    [
      'too much history',
      { question: 'x', history: Array(11).fill({ role: 'user', content: 'a' }) },
    ],
    ['a history role', { question: 'x', history: [{ role: 'system', content: 'a' }] }],
    [
      'history content over 8000',
      { question: 'x', history: [{ role: 'user', content: 'a'.repeat(8001) }] },
    ],
    ['a notePath that is not a note', { question: 'x', notePath: '2 Areas/a.pdf' }],
  ])('refuses %s with a JSON 400 before any stream', async (_label, body) => {
    const before = a.runtime.requests.length;
    const res = await a.t.call('POST', '/api/ai/chat', body);
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.json().error.code).toBe('VALIDATION');
    expect(a.runtime.requests.length).toBe(before);
  });

  it.each([
    '../x.md',
    '0 Inbox/../../x.md',
    '.secondbrain/vault.json',
    '.SecondBrain/state/x.md',
    '.git/x.md',
    '/etc/x.md',
    'C:\\Windows\\x.md',
    '//server/share/x.md',
    '\\\\server\\share\\x.md',
    'CON.md',
    '0 Inbox/a.md:hidden.md',
    '0 Inbox/a\u0000.md',
    '0 Inbox/a .md ',
  ])('path guard: notePath, action path and save folder %s → INVALID_PATH', async (bad) => {
    const chat = await a.t.call('POST', '/api/ai/chat', { question: 'x', notePath: bad });
    expect(chat.json().error.code).toBe('INVALID_PATH');
    const action = await a.t.call('POST', '/api/ai/action', {
      action: 'explain',
      text: 'x',
      path: bad,
    });
    expect(action.json().error.code).toBe('INVALID_PATH');
    const folder = bad.replace(/\.md\s*$/, '');
    const save = await a.t.call('POST', '/api/ai/save-answer', {
      question: 'q',
      answer: 'a',
      folder,
    });
    expect(save.json().error.code).toBe('INVALID_PATH');
  });

  it('not ready, or over budget before the stream: plain JSON errors, nothing sent', async () => {
    a.runtime.options.notReady = new AiError('AI_DISABLED', 'AI is off.');
    const before = a.runtime.requests.length;
    for (const route of ROUTES.filter(
      (r) => r.url !== '/api/ai/today-summary' && r.url !== '/api/ai/save-answer',
    )) {
      const res = await a.t.call(route.method, route.url, route.payload);
      expect(res.statusCode, route.url).toBe(409);
      expect(res.json().error.code).toBe('AI_DISABLED');
    }
    a.runtime.options.notReady = null;
    a.runtime.options.refuse = { chat: new AiError('AI_BUDGET', 'Monthly limit reached.') };
    const budget = await a.t.call('POST', '/api/ai/chat', { question: 'Ma trận là gì?' });
    expect(budget.statusCode).toBe(429);
    expect(budget.json().error.code).toBe('AI_BUDGET');
    a.runtime.options.refuse = { intent: new AiError('AI_BUDGET', 'Monthly limit reached.') };
    expect(
      (await a.t.call('POST', '/api/ai/chat', { question: 'Ma trận là gì?' })).statusCode,
    ).toBe(429);
    a.runtime.options.refuse = {};
    expect(a.runtime.requests.length).toBe(before + 1); // only the intent call of the first try
  });

  it('a provider failure after the stream started ends it with an error event', async () => {
    a.runtime.options.beforeDelta = async (_request, index) => {
      if (index === 1)
        throw new AiError('AI_PROVIDER_ERROR', 'The provider failed.', { reason: 'server' });
    };
    try {
      const reply = await ask(a.t, { question: 'Ma trận là gì?' });
      expect(reply.events.map((e) => e.event)).toEqual(['meta', 'delta', 'error']);
      expect(reply.events.at(-1)!.data).toEqual({
        code: 'AI_PROVIDER_ERROR',
        message: 'The provider failed.',
        // The reason code only, so the client words its own message.
        details: { reason: 'server' },
      });
    } finally {
      a.runtime.options.beforeDelta = undefined;
    }
  });

  it('a client that disconnects aborts the provider request', async () => {
    let release: () => void = () => undefined;
    a.runtime.options.beforeDelta = (request, index) =>
      index === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            release = resolve;
            request.signal?.addEventListener('abort', () => resolve(), { once: true });
          });
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port: PORT,
            method: 'POST',
            path: '/api/ai/chat',
            headers: {
              host: `localhost:${PORT}`,
              origin: `http://localhost:${PORT}`,
              'x-sb-token': TEST_TOKEN,
              'content-type': 'application/json',
            },
          },
          (res) => {
            res.on('data', (chunk: Buffer) => {
              if (chunk.toString().includes('event: delta')) {
                req.destroy();
                resolve();
              }
            });
          },
        );
        req.on('error', () => undefined);
        req.end(JSON.stringify({ question: 'Ma trận là gì?' }));
        setTimeout(() => reject(new Error('no delta arrived')), 3000);
      });
      const stream = a.runtime.requests.filter((r) => r.purpose === 'chat').at(-1)!;
      await waitUntil(() => (stream.signal?.aborted ? true : undefined), 2000);
    } finally {
      release();
      a.runtime.options.beforeDelta = undefined;
    }
  });

  it.each(ROUTES.map((route) => [`${route.method} ${route.url}`, route] as const))(
    '%s: token, Host and Origin rules',
    async (_label, route) => {
      const send = (headers: Record<string, string>) =>
        a.t.app.inject({
          method: route.method,
          url: route.url,
          headers,
          ...('payload' in route ? { payload: route.payload } : {}),
        });
      const host = `localhost:${PORT}`;
      expect((await send({ host })).statusCode).toBe(401);
      expect((await send({ host, 'x-sb-token': 'wrong' })).statusCode).toBe(401);
      expect((await send({ host: 'evil.example', 'x-sb-token': TEST_TOKEN })).statusCode).toBe(421);
      if (route.method !== 'GET') {
        const res = await send({ host, 'x-sb-token': TEST_TOKEN, origin: 'http://evil.example' });
        expect(res.statusCode).toBe(403);
      }
    },
  );

  it('semantic search: BM25 without embeddings, hybrid with them, in scope only', async () => {
    const bm25 = await a.t.call('POST', '/api/ai/search', { q: 'ma trận', limit: 5 });
    expect(bm25.json()).toEqual({
      mode: 'bm25',
      results: [
        {
          path: '2 Areas/Đại số tuyến tính – chương 3.md',
          title: 'Đại số tuyến tính – chương 3',
          // Plain text: no heading marker.
          snippet: 'Ma trận Ma trận vuông, định thức và trị riêng.',
          page: null,
          score: 1,
        },
      ],
    });
    const embeddings: EmbeddingIndex = {
      isReady: () => true,
      query: async () => [
        {
          path: '4 Archive/Ma trận cũ.md',
          score: 0.99,
          chunk: { index: 0, startLine: 1, endLine: 1, heading: null, text: 'Ma trận cũ.' },
        },
        {
          path: '2 Areas/Giải tích.md',
          score: 0.5,
          chunk: {
            index: 0,
            startLine: 1,
            endLine: 1,
            heading: null,
            text: 'Đạo hàm và tích phân.',
          },
        },
      ],
    };
    a.runtime.options.embeddings = embeddings;
    try {
      const hybrid = (await a.t.call('POST', '/api/ai/search', { q: 'bài về ma trận' })).json();
      expect(hybrid.mode).toBe('hybrid');
      expect(hybrid.results.map((r: { path: string }) => r.path)).toEqual([
        '2 Areas/Đại số tuyến tính – chương 3.md',
        '2 Areas/Giải tích.md',
      ]);
    } finally {
      a.runtime.options.embeddings = null;
    }
    for (const body of [{ q: '' }, { q: 'x', limit: 21 }, { q: 'x', mode: 'hybrid' }]) {
      expect((await a.t.call('POST', '/api/ai/search', body)).statusCode).toBe(400);
    }
  });
});

describe('AI API without the AI plugin', () => {
  let a: AiTestApp;
  beforeAll(async () => {
    a = await createAiTestApp(47748, { files: FILES, plugins: [] });
  });
  afterAll(async () => a?.t.close());

  it('answers 503 UNAVAILABLE for AI calls; reading the Today cache and saving still work', async () => {
    for (const route of ROUTES.filter(
      (r) => r.method === 'POST' && r.url !== '/api/ai/save-answer',
    )) {
      const res = await a.t.call(route.method, route.url, route.payload);
      expect(res.statusCode, route.url).toBe(503);
      expect(res.json().error.code).toBe('UNAVAILABLE');
    }
    expect((await a.t.call('GET', '/api/ai/today-summary')).json()).toEqual({
      date: '2026-10-19',
      text: null,
    });
    const saved = await a.t.call('POST', '/api/ai/save-answer', {
      question: 'Câu hỏi',
      answer: 'Trả lời',
      folder: '2 Areas',
    });
    expect(saved.statusCode).toBe(201);
    expect(parseSse('')).toEqual([]);
  });
});
