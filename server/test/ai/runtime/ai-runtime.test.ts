import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiError, type ChatRequest } from '../../../src/ai/ai-types.js';
import {
  sseEvents,
  sseResponse,
  TEST_KEYS,
  type Responder,
} from '../providers/provider-test-kit.js';
import { configureAi, createAiTestApp, type AiTestApp } from './ai-test-kit.js';

const PORT = 47730;
const QUESTION = 'Câu hỏi riêng tư về Đồ án Giải tích';
const ANSWER = 'Trả lời bí mật';
const request: ChatRequest = {
  purpose: 'chat',
  system: 'Hệ thống',
  messages: [{ role: 'user', content: QUESTION }],
  maxTokens: 200,
};

const anthropicAnswer: Responder = () =>
  sseResponse([
    sseEvents([
      { type: 'message_start', message: { usage: { input_tokens: 120, output_tokens: 1 } } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: ANSWER } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 30 } },
      { type: 'message_stop' },
    ]),
  ]);

const errorOf = (run: () => unknown): AiError => {
  try {
    run();
  } catch (error) {
    return error as AiError;
  }
  throw new Error('expected an AiError');
};

describe('AI runtime: readiness, calls, usage, scope, status (F33)', () => {
  let t: AiTestApp;

  beforeAll(async () => {
    t = await createAiTestApp(PORT, {
      respond: anthropicAnswer,
      seed: (root) => {
        for (const folder of ['0 Inbox', '1 Projects/Đồ án', '2 Areas', '3 Resources', '4 Archive'])
          mkdirSync(path.join(root, folder), { recursive: true });
        writeFileSync(path.join(root, 'Ghi chú gốc.md'), '# Gốc\n');
      },
    });
  });
  afterAll(async () => t?.close());
  beforeEach(() => {
    t.settings.ai.monthlyTokenLimit = 2_000_000;
    t.settings.ai.folders = null;
    t.recorder.requests.length = 0;
  });

  it('assertReady checks disabled → no-consent → no-key → budget, without network', () => {
    const ai = t.settings.ai;
    ai.enabled = false;
    ai.consent = null;
    ai.apiKeys = {};
    const runtime = t.runtime();
    expect(errorOf(() => runtime.assertReady('chat'))).toMatchObject({
      code: 'AI_DISABLED',
      details: { reason: 'disabled' },
    });
    ai.enabled = true;
    expect(errorOf(() => runtime.assertReady('chat'))).toMatchObject({
      code: 'AI_DISABLED',
      details: { reason: 'no-consent' },
    });
    ai.consent = { at: new Date().toISOString(), provider: 'anthropic' };
    expect(errorOf(() => runtime.assertReady('intent')).code).toBe('AI_NO_KEY');
    ai.apiKeys = { openai: TEST_KEYS.openai }; // a key, but not for the chat provider
    expect(errorOf(() => runtime.assertReady('chat')).code).toBe('AI_NO_KEY');
    // Embeddings: their own switch, consent and key (openai here).
    expect(errorOf(() => runtime.assertReady('embed')).details).toEqual({ reason: 'disabled' });
    ai.embeddings = true;
    expect(errorOf(() => runtime.assertReady('embed')).details).toEqual({ reason: 'no-consent' });
    ai.embeddingsConsent = { at: new Date().toISOString(), provider: 'openai' };
    expect(() => runtime.assertReady('embed')).not.toThrow();
    ai.apiKeys = { ...TEST_KEYS };
    expect(() => runtime.assertReady('chat')).not.toThrow();
    ai.monthlyTokenLimit = 10_000;
    t.runtime().settingsChanged?.();
    // A provider change voids the consent until she agrees again.
    ai.provider = 'gemini';
    expect(errorOf(() => runtime.assertReady('chat')).details).toEqual({ reason: 'no-consent' });
    ai.provider = 'anthropic';
    ai.embeddings = false;
    expect(t.recorder.requests).toHaveLength(0);
  });

  it('stream calls the configured provider, records real usage and logs no content', async () => {
    configureAi(t);
    const before = t.runtime().status().usage.tokens;
    let text = '';
    for await (const event of t.runtime().stream(request))
      if (event.type === 'delta') text += event.text;
    expect(text).toBe(ANSWER);
    expect(t.recorder.requests).toHaveLength(1);
    expect(t.recorder.requests[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(t.recorder.requests[0]!.headers['x-api-key']).toBe(TEST_KEYS.anthropic);
    expect(t.runtime().status().usage.tokens).toBe(before + 150);
    const log = t.logger.lines.join('\n');
    expect(log).toMatch(/AI chat anthropic: ok, 150 tokens, \d+ ms\./);
    for (const secret of [...Object.values(TEST_KEYS), QUESTION, ANSWER, 'Hệ thống'])
      expect(log).not.toContain(secret);
  });

  it('complete returns the whole answer; the chat model setting overrides the default', async () => {
    configureAi(t);
    t.settings.ai.chatModel = 'claude-test-model';
    const result = await t.runtime().complete({ ...request, purpose: 'intent', json: true });
    t.settings.ai.chatModel = null;
    expect(result).toEqual({ text: ANSWER, usage: { inputTokens: 120, outputTokens: 30 } });
    expect(t.recorder.requests[0]!.body.model).toBe('claude-test-model');
  });

  it('refuses synchronously before any request: off, or the estimate passes the budget', async () => {
    configureAi(t);
    t.settings.ai.enabled = false;
    expect(errorOf(() => t.runtime().stream(request)).code).toBe('AI_DISABLED');
    await expect(t.runtime().complete(request)).rejects.toMatchObject({ code: 'AI_DISABLED' });
    t.settings.ai.enabled = true;
    const used = t.runtime().status().usage.tokens;
    t.settings.ai.monthlyTokenLimit = used + 250; // estimate = 12 chars/4 + 200 output → 207+
    expect(errorOf(() => t.runtime().stream({ ...request, maxTokens: 260 })).code).toBe(
      'AI_BUDGET',
    );
    expect(t.recorder.requests).toHaveLength(0);
  });

  it('crossing the limit pauses AI and tells clients (ai:status)', async () => {
    configureAi(t);
    const used = t.runtime().status().usage.tokens;
    t.settings.ai.monthlyTokenLimit = used + 230;
    t.runtime().settingsChanged?.();
    const events = t.statusEvents.length;
    await t.runtime().complete(request); // 150 real tokens → still below
    await t.runtime().complete({ ...request, maxTokens: 10 }); // crosses
    const status = t.runtime().status();
    expect(status.usage).toMatchObject({ paused: true, limit: used + 230 });
    expect(status).toMatchObject({ ready: false, reason: 'budget' });
    expect(t.statusEvents.length).toBeGreaterThan(events);
    expect(errorOf(() => t.runtime().assertReady('chat')).code).toBe('AI_BUDGET');
  });

  it('inScope: default scope, classes, custom folders and root notes', () => {
    const inScope = (p: string) => t.runtime().inScope(p);
    t.settings.ai.folders = null;
    expect(inScope('0 Inbox/a.md')).toBe(true);
    expect(inScope('Ghi chú gốc.md')).toBe(true);
    expect(inScope('wiki/concepts/Ma trận.md')).toBe(true);
    expect(inScope('3 Resources/papers/x.pdf')).toBe(false);
    expect(inScope('3 resources/notes.md')).toBe(false);
    expect(inScope('4 Archive/old.md')).toBe(false);
    expect(inScope('Templates/Note.md')).toBe(false);
    expect(inScope('Attachments/2026-10/a.png')).toBe(false);
    expect(inScope('2 Areas/scan.png')).toBe(false);
    expect(inScope('.secondbrain/state/reminders.json')).toBe(false);
    expect(inScope('0 Inbox/../4 Archive/old.md')).toBe(false);
    t.settings.ai.folders = ['2 Areas', '1 Projects/Đồ án'];
    expect(inScope('2 Areas/Giải tích.md')).toBe(true);
    expect(inScope('1 Projects/Đồ án/kế hoạch.md')).toBe(true);
    expect(inScope('1 Projects/Khác.md')).toBe(false);
    expect(inScope('Ghi chú gốc.md')).toBe(false);
    t.settings.ai.folders = ['', '4 Archive'];
    expect(inScope('Ghi chú gốc.md')).toBe(true);
    expect(inScope('4 Archive/old.md')).toBe(true);
    expect(inScope('Templates/Note.md')).toBe(false);
  });

  it('status: the AiStatus contract, no key in it, bm25 while embeddings are off', async () => {
    configureAi(t);
    const res = await t.call('GET', '/api/ai/status');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const status = res.json();
    expect(status).toMatchObject({
      available: true,
      enabled: true,
      consented: true,
      provider: 'anthropic',
      hasKey: true,
      chatModel: 'claude-haiku-5-5',
      ready: true,
      reason: null,
      retrieval: 'bm25',
      embeddings: {
        enabled: false,
        consented: true,
        provider: 'openai',
        model: 'text-embedding-3-small',
        hasKey: true,
        state: 'off',
        pending: 0,
        lastError: null,
      },
      usage: { month: '2026-10', limit: 2_000_000, paused: false },
    });
    // Default scope: every top folder except 3 Resources, 4 Archive (and never-sent folders).
    expect(status.scope).toEqual(['', '0 Inbox', '1 Projects', '2 Areas', 'Daily', 'wiki']);
    for (const key of Object.values(TEST_KEYS)) expect(res.body).not.toContain(key.slice(0, 16));
  });
});
