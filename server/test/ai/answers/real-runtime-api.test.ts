/**
 * The answers on top of the real AI runtime (AP) with a recording fetch: what reaches the
 * provider's HTTP API, end to end. Never the network.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAiPlugin } from '../../../src/ai/ai-plugin.js';
import type { AiRuntime } from '../../../src/ai/ai-types.js';
import { AI_PLUGIN } from '../../../src/app-context/vault-plugins.js';
import {
  recordingFetch,
  sseEvents,
  sseResponse,
  TEST_KEYS,
  type RecordedRequest,
} from '../providers/provider-test-kit.js';
import { ask, createAiTestApp, MONDAY, type AiTestApp } from './ai-test-app.js';

/** Anthropic Messages streaming events carrying `text`. */
function anthropicStream(text: string) {
  return sseResponse([
    sseEvents(
      [
        { type: 'message_start', message: { usage: { input_tokens: 42 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
        { type: 'message_stop' },
      ],
      { named: true },
    ),
  ]);
}

function respond(request: RecordedRequest) {
  const system = String(request.body.system ?? '');
  if (system.startsWith('You classify')) {
    const messages = request.body.messages as { content: string }[];
    const deadline = messages.at(-1)!.content.includes('<question>\nTuần này có gì đến hạn?');
    return anthropicStream(
      deadline
        ? '{"kind":"deadlines","from":"2026-10-19","to":"2026-10-25","overdue":true,"about":[]}'
        : '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}',
    );
  }
  if (system.includes('lời mở đầu')) return anthropicStream('Tuần này bạn có 1 deadline.');
  return anthropicStream('Ma trận vuông có định thức [S1].');
}

const FILES = {
  '2 Areas/Đại số tuyến tính – chương 3.md':
    'Ma trận vuông có định thức.\n- [ ] Nộp bài 📅 2026-10-21\n',
  '4 Archive/Ma trận lưu trữ.md': 'Ma trận lưu trữ bí mật.\n',
};

describe('answers through the real AI runtime and an injected fetch', () => {
  let a: AiTestApp;
  const recorder = recordingFetch(respond);
  const runtime = () => a.t.context.plugin<AiRuntime>(AI_PLUGIN)!;

  beforeAll(async () => {
    a = await createAiTestApp(47749, {
      files: FILES,
      plugins: [createAiPlugin({ fetch: recorder.fetch, env: {} })],
    });
  });
  afterAll(async () => a?.t.close());

  it('with AI off nothing is sent and the chat answers 409', async () => {
    const res = await a.t.call('POST', '/api/ai/chat', { question: 'Ma trận là gì?' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AI_DISABLED');
    expect(recorder.requests).toEqual([]);
  });

  it('a text question: intent and answer calls, citation turned into a link, scope kept', async () => {
    const ai = a.t.settings.ai;
    const at = MONDAY.toISOString();
    Object.assign(ai, {
      provider: 'anthropic',
      enabled: true,
      consent: { at, provider: 'anthropic' },
      apiKeys: { ...TEST_KEYS },
    });
    runtime().settingsChanged?.();
    const reply = await ask(a.t, { question: 'Ma trận là gì?' });
    expect(reply.response.statusCode, reply.response.body).toBe(200);
    expect(reply.done.answer).toBe(
      'Ma trận vuông có định thức [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]].',
    );
    expect(reply.done.usage).toEqual({ inputTokens: 84, outputTokens: 14 });
    expect(recorder.requests).toHaveLength(2);
    for (const request of recorder.requests) {
      expect(request.url).toMatch(/\/v1\/messages$/);
      expect(request.rawBody).not.toContain('bí mật');
      expect(request.rawBody).not.toContain('4 Archive');
    }
  });

  it('a deadline question: the list comes from the deadline service', async () => {
    const reply = await ask(a.t, { question: 'Tuần này có gì đến hạn?' });
    expect(reply.done.answer).toBe(
      'Tuần này bạn có 1 deadline.\n\n**Thứ tư 21/10 (còn 2 ngày)**\n- Nộp bài (trong [[2 Areas/Đại số tuyến tính – chương 3|Đại số tuyến tính – chương 3]])',
    );
    expect(recorder.requests.at(-1)!.rawBody).not.toContain('Nộp bài');
  });
});
