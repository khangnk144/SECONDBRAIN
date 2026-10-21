/**
 * The monthly cap under concurrent requests: every request in flight holds its estimate, so chat
 * calls and embedding batches started together cannot pass the limit (their real usage replaces
 * the estimate when they end). A request that outlives its usage store (a vault switch) records
 * into the store open now, or into the file, never through stale numbers.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAiPlugin } from '../../../src/ai/ai-plugin.js';
import type { AiRuntime, ChatRequest } from '../../../src/ai/ai-types.js';
import {
  openUsageStore,
  USAGE_FILE_NAME,
  type UsageStore,
} from '../../../src/ai/budget/usage-store.js';
import { embedTexts, type EmbeddingDeps } from '../../../src/ai/embeddings/embedding-deps.js';
import { completeChat, streamChat, type ChatCallDeps } from '../../../src/ai/runtime/chat-calls.js';
import { AI_PLUGIN } from '../../../src/app-context/vault-plugins.js';
import type { GlobalSettings } from '../../../src/config/global-settings.js';
import { createMemoryLogger, waitUntil } from '../../api/vault-test-app.js';
import { makeSettings, makeTempDir, removeDir } from '../../helpers/test-environment.js';
import { createAiTestApp, MONDAY, type AiTestApp } from '../answers/ai-test-app.js';
import {
  jsonResponse,
  ManualTimers,
  recordingFetch,
  sseEvents,
  sseResponse,
  TEST_KEYS,
} from '../providers/provider-test-kit.js';

const NOW = new Date('2026-10-21T09:00:00');
const consent = (provider: 'anthropic' | 'openai') => ({ at: NOW.toISOString(), provider });

function anthropicStream(input: number, output: number): Response {
  return sseResponse([
    sseEvents(
      [
        { type: 'message_start', message: { usage: { input_tokens: input } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Tóm tắt.' } },
        {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: output },
        },
        { type: 'message_stop' },
      ],
      { named: true },
    ),
  ]);
}

/** Estimate 3,000 tokens: 4,000 characters (1,000) + 2,000 output allowance. */
const request3000 = (): ChatRequest => ({
  purpose: 'action',
  system: 'x'.repeat(3996),
  messages: [{ role: 'user', content: 'abcd' }],
  maxTokens: 2000,
});

const outcome = (call: Promise<unknown>) =>
  call.then(
    () => 'ok',
    (error: { code?: string }) => error.code ?? 'error',
  );

describe('budget reservations: chat and embeddings in flight (F33.5)', () => {
  let dir: string;
  let usage: UsageStore;
  let settings: GlobalSettings;
  let release: () => void;
  let gate: Promise<void>;
  const logger = createMemoryLogger();
  const recorder = recordingFetch(async (request) => {
    await gate; // every request is in flight before any finishes
    if (request.url.endsWith('/embeddings')) {
      const input = request.body.input as string[];
      const embedding = new Array<number>(request.body.dimensions as number).fill(0.5);
      return jsonResponse({
        data: input.map((_, index) => ({ index, embedding })),
        usage: { prompt_tokens: 100, total_tokens: 100 },
      });
    }
    return anthropicStream(1000, 1500); // 2,500: within the 3,000 estimate
  });
  const chatDeps = (): ChatCallDeps => ({
    settings: () => settings,
    usage,
    fetch: recorder.fetch,
    timers: new ManualTimers(),
    now: () => NOW,
    env: {},
    logger,
    onUsage: () => undefined,
  });
  const embedDeps = (): EmbeddingDeps => ({
    ...chatDeps(),
    context: undefined as never,
    inScope: () => true,
    broadcast: () => undefined,
  });

  beforeEach(async () => {
    dir = path.join(makeTempDir('sb ngân sách Đồng thời'), '.secondbrain');
    mkdirSync(dir);
    usage = await openUsageStore({ dir, timers: new ManualTimers(), logger, now: () => NOW });
    settings = makeSettings();
    Object.assign(settings.ai, {
      provider: 'anthropic',
      enabled: true,
      consent: consent('anthropic'),
      embeddings: true,
      embeddingProvider: 'openai',
      embeddingsConsent: consent('openai'),
      apiKeys: { ...TEST_KEYS },
      monthlyTokenLimit: 10_000,
    });
    recorder.requests.length = 0;
    gate = new Promise((resolve) => (release = resolve));
  });
  afterEach(async () => {
    release();
    await usage.close();
    removeDir(path.dirname(dir));
  });

  it('ten chat calls at once with a 10,000-token cap: three are sent, seven refused', async () => {
    const calls = Array.from({ length: 10 }, () =>
      outcome(completeChat(chatDeps(), request3000())),
    );
    await waitUntil(() => (recorder.requests.length === 3 ? true : undefined));
    expect(usage.reserved()).toBe(9000);
    release();
    const results = await Promise.all(calls);
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'AI_BUDGET')).toHaveLength(7);
    expect(recorder.requests).toHaveLength(3);
    expect(usage.reserved()).toBe(0);
    expect(usage.month(NOW).tokens).toBe(7500);
    // The real usage replaced the estimates: 2,500 tokens of room are left, not 1,000.
    await expect(completeChat(chatDeps(), request3000())).rejects.toMatchObject({
      code: 'AI_BUDGET',
    });
    expect(await outcome(completeChat(chatDeps(), { ...request3000(), maxTokens: 1000 }))).toBe(
      'ok',
    );
  });

  it('an embedding batch counts the chat in flight, and the other way round', async () => {
    const chat = outcome(completeChat(chatDeps(), request3000()));
    const big = Array.from({ length: 8 }, () => 'v'.repeat(4000)); // 8,000 tokens
    await expect(embedTexts(embedDeps(), big, undefined)).rejects.toMatchObject({
      code: 'AI_BUDGET',
    });
    const small = embedTexts(embedDeps(), ['ma trận'.repeat(1000)], undefined);
    expect(usage.reserved()).toBe(3000 + 1750);
    settings.ai.monthlyTokenLimit = 7000;
    await expect(completeChat(chatDeps(), request3000())).rejects.toMatchObject({
      code: 'AI_BUDGET',
    });
    release();
    expect(await chat).toBe('ok');
    expect(await small).toHaveLength(1);
    expect(usage.reserved()).toBe(0);
    expect(usage.month(NOW)).toMatchObject({ tokens: 2600, requests: 2 });
  });

  it('a stream never read holds nothing; a failed one gives its estimate back', async () => {
    const unread = streamChat(chatDeps(), request3000());
    expect(usage.reserved()).toBe(0);
    void unread;
    recorder.respondWith(() => new Response('{"error":{}}', { status: 500 }));
    release();
    expect(await outcome(completeChat(chatDeps(), request3000()))).toBe('AI_PROVIDER_ERROR');
    expect(usage.reserved()).toBe(0);
    expect(usage.month(NOW).tokens).toBe(0);
  });
});

describe('usage recorded after the store closed (vault switch)', () => {
  let dir: string;
  const logger = createMemoryLogger();
  const file = () => path.join(dir, USAGE_FILE_NAME);
  const stored = () => JSON.parse(readFileSync(file(), 'utf8')).months['2026-10'];
  const open = () => openUsageStore({ dir, timers: new ManualTimers(), logger, now: () => NOW });

  beforeEach(() => {
    dir = path.join(makeTempDir('sb usage Chuyển kho'), '.secondbrain');
    mkdirSync(dir);
  });
  afterEach(() => removeDir(path.dirname(dir)));

  it('goes to the store open now; the closed one never writes its old numbers', async () => {
    const old = await open();
    old.record(100, NOW);
    const late = old.reserve(3000);
    await old.close();
    const current = await open();
    current.record(500, NOW);
    old.record(10, NOW);
    late.settle(700, NOW);
    expect(current.month(NOW)).toMatchObject({ tokens: 1310, requests: 4 });
    expect(old.month(NOW).tokens).toBe(1310);
    await current.close();
    expect(stored()).toEqual({ tokens: 1310, requests: 4 });
  });

  it('with no store open, it is added to the file itself', async () => {
    const old = await open();
    old.record(100, NOW);
    await old.close();
    old.record(40, NOW);
    await waitUntil(() => (stored().tokens === 140 ? true : undefined));
    const next = await open();
    expect(next.month(NOW)).toMatchObject({ tokens: 140, requests: 2 });
    await next.close();
  });
});

describe('ten summaries at once through the API (F33.5)', () => {
  let a: AiTestApp;
  let release: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const recorder = recordingFetch(async () => {
    await gate;
    return anthropicStream(300, 500); // well within each request's estimate
  });
  beforeAll(async () => {
    a = await createAiTestApp(47613, {
      files: { '1 Projects/Ghi chú.md': 'Nội dung.\n' },
      plugins: [createAiPlugin({ fetch: recorder.fetch, env: {} })],
    });
    Object.assign(a.t.settings.ai, {
      provider: 'anthropic',
      enabled: true,
      consent: { at: MONDAY.toISOString(), provider: 'anthropic' },
      apiKeys: { anthropic: TEST_KEYS.anthropic },
      monthlyTokenLimit: 3000,
    });
  });
  afterAll(async () => {
    release();
    await a?.t.close();
  });

  it('never passes the cap: the requests that do not fit are refused before sending', async () => {
    const calls = Array.from({ length: 10 }, () =>
      a.t.call('POST', '/api/ai/action', { action: 'summarize', text: 'Ma trận vuông.' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const sent = recorder.requests.length;
    release();
    const codes = (await Promise.all(calls)).map((r) => r.statusCode);
    expect(sent).toBeGreaterThan(0);
    expect(codes.filter((c) => c === 200)).toHaveLength(sent);
    expect(codes.filter((c) => c === 429)).toHaveLength(10 - sent);
    const runtime = a.t.context.plugin<AiRuntime>(AI_PLUGIN)!;
    expect(runtime.status().usage.tokens).toBe(sent * 800);
    expect(runtime.status().usage.tokens).toBeLessThanOrEqual(3000);
  });
});
