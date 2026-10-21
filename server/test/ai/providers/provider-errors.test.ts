import { describe, expect, it } from 'vitest';
import { AiError, type ChatRequest } from '../../../src/ai/ai-types.js';
import { anthropicProvider } from '../../../src/ai/providers/anthropic-provider.js';
import { geminiProvider } from '../../../src/ai/providers/gemini-provider.js';
import { openAiProvider } from '../../../src/ai/providers/openai-provider.js';
import {
  FIRST_BYTE_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS,
} from '../../../src/ai/providers/provider-http.js';
import type { ChatProviderModule, ProviderCall } from '../../../src/ai/providers/provider-types.js';
import {
  hangingResponse,
  jsonResponse,
  ManualTimers,
  recordingFetch,
  sseEvents,
  sseResponse,
  stalledBodyResponse,
  TEST_KEYS,
  type Responder,
} from './provider-test-kit.js';

const PROMPT_SECRET = 'Ghi chú bí mật về Đồ án';
const request: ChatRequest = {
  purpose: 'chat',
  system: 'Hệ thống',
  messages: [{ role: 'user', content: PROMPT_SECRET }],
  maxTokens: 100,
};
const providers: [string, ChatProviderModule, string][] = [
  ['anthropic', anthropicProvider, TEST_KEYS.anthropic],
  ['openai', openAiProvider, TEST_KEYS.openai],
  ['gemini', geminiProvider, TEST_KEYS.gemini],
];

async function failure(
  provider: ChatProviderModule,
  key: string,
  respond: Responder,
  extra: Partial<ProviderCall> = {},
): Promise<AiError> {
  const recorder = recordingFetch(respond);
  try {
    for await (const _event of provider.streamChat(
      { baseUrl: 'https://provider.test', model: 'm', key, fetch: recorder.fetch, ...extra },
      request,
    ));
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    const aiError = error as AiError;
    // Neither the key, the prompt nor the provider's text may travel with the error.
    const dump = `${aiError.message} ${String(aiError)} ${JSON.stringify(aiError.details)} ${aiError.stack}`;
    expect(dump).not.toContain(key);
    expect(dump).not.toContain(key.slice(0, 16));
    expect(dump).not.toContain(PROMPT_SECRET);
    expect(dump).not.toContain('PROVIDER-TEXT');
    return aiError;
  }
  throw new Error('expected a failure');
}

const errorBody = (extra = '') =>
  jsonResponse({ error: { message: `PROVIDER-TEXT ${extra} echo ${TEST_KEYS.openai}` } });

describe('provider errors map to AI_PROVIDER_ERROR reasons (F33)', () => {
  it.each([
    [401, '', 'auth'],
    [403, '', 'auth'],
    [402, '', 'quota'],
    [429, '', 'rate-limit'],
    [429, 'insufficient_quota', 'quota'],
    [400, 'Your credit balance is too low', 'quota'],
    [400, '', 'bad-request'],
    [404, '', 'bad-request'],
    [422, '', 'bad-request'],
    [408, '', 'timeout'],
    [500, '', 'server'],
    [503, '', 'server'],
    [529, '', 'server'],
  ])('HTTP %i %s → %s (every provider)', async (status, text, reason) => {
    for (const [, provider, key] of providers) {
      const error = await failure(
        provider,
        key,
        () => new Response(errorBody(text).body, { status }),
      );
      expect(error.code).toBe('AI_PROVIDER_ERROR');
      expect(error.details).toEqual({ reason, status });
    }
  });

  it('a network failure is `network`; a broken stream or bad JSON is `malformed`', async () => {
    for (const [name, provider, key] of providers) {
      const network = await failure(provider, key, () => {
        throw new TypeError(`fetch failed PROVIDER-TEXT ${key}`);
      });
      expect(network.details, name).toEqual({ reason: 'network', status: null });
      const badJson = await failure(provider, key, () => sseResponse(['data: {not json\n\n']));
      expect(badJson.details?.reason, name).toBe('malformed');
    }
    // Cut off before the end marker (Anthropic message_stop, OpenAI [DONE]); empty Gemini stream.
    const cut = sseEvents([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } },
    ]);
    expect(
      (await failure(anthropicProvider, 'k'.repeat(20), () => sseResponse([cut]))).details?.reason,
    ).toBe('malformed');
    const openCut = sseEvents([{ choices: [{ delta: { content: 'x' } }] }]);
    expect(
      (await failure(openAiProvider, 'k'.repeat(20), () => sseResponse([openCut]))).details?.reason,
    ).toBe('malformed');
    expect(
      (await failure(geminiProvider, 'k'.repeat(20), () => sseResponse(['']))).details?.reason,
    ).toBe('malformed');
  });

  it('errors inside the stream are classified without their text', async () => {
    const anthropicError = sseEvents([
      { type: 'message_start', message: { usage: { input_tokens: 3 } } },
      { type: 'error', error: { type: 'overloaded_error', message: 'PROVIDER-TEXT' } },
    ]);
    const a = await failure(anthropicProvider, TEST_KEYS.anthropic, () =>
      sseResponse([anthropicError]),
    );
    expect(a.details?.reason).toBe('server');
    const rate = sseEvents([
      { type: 'error', error: { type: 'rate_limit_error', message: 'PROVIDER-TEXT' } },
    ]);
    expect(
      (await failure(anthropicProvider, TEST_KEYS.anthropic, () => sseResponse([rate]))).details
        ?.reason,
    ).toBe('rate-limit');
    const openError = sseEvents([
      { error: { code: 'insufficient_quota', message: 'PROVIDER-TEXT' } },
    ]);
    expect(
      (await failure(openAiProvider, TEST_KEYS.openai, () => sseResponse([openError]))).details
        ?.reason,
    ).toBe('quota');
    const geminiError = sseEvents([
      { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'PROVIDER-TEXT' } },
    ]);
    expect(
      (await failure(geminiProvider, TEST_KEYS.gemini, () => sseResponse([geminiError]))).details
        ?.reason,
    ).toBe('rate-limit');
  });

  it('30 s without a first byte → timeout (fetch hanging, or headers then silence)', async () => {
    for (const respond of [hangingResponse, () => stalledBodyResponse()] as Responder[]) {
      const timers = new ManualTimers();
      const pending = failure(openAiProvider, TEST_KEYS.openai, respond, { timers });
      await new Promise((resolve) => setTimeout(resolve, 10));
      timers.advance(FIRST_BYTE_TIMEOUT_MS - 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
      timers.advance(1);
      const error = await pending;
      expect(error.details).toEqual({ reason: 'timeout', status: null });
      expect(timers.pending).toBe(0); // every timer cleared
    }
  });

  it('120 s in total → timeout even while bytes keep coming', async () => {
    const timers = new ManualTimers();
    let push: ((text: string) => void) | null = null;
    const respond: Responder = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            push = (text) => controller.enqueue(new TextEncoder().encode(text));
          },
        }),
      );
    const pending = failure(anthropicProvider, TEST_KEYS.anthropic, respond, { timers });
    await new Promise((resolve) => setTimeout(resolve, 10));
    for (let second = 0; second < 119; second += 20) {
      push!(': still thinking\n');
      await new Promise((resolve) => setTimeout(resolve, 5));
      timers.advance(20_000);
    }
    timers.advance(TOTAL_TIMEOUT_MS);
    expect((await pending).details?.reason).toBe('timeout');
  });

  it("the caller's signal cancels a request (reason `aborted`), before or during it", async () => {
    const before = new AbortController();
    before.abort();
    const early = await failure(geminiProvider, TEST_KEYS.gemini, hangingResponse, {
      signal: before.signal,
    });
    expect(early.details?.reason).toBe('aborted');

    const during = new AbortController();
    const pending = failure(geminiProvider, TEST_KEYS.gemini, hangingResponse, {
      signal: during.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    during.abort();
    expect((await pending).details?.reason).toBe('aborted');

    const stalled = new AbortController();
    const reading = failure(anthropicProvider, TEST_KEYS.anthropic, () => stalledBodyResponse(), {
      signal: stalled.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    stalled.abort();
    expect((await reading).details?.reason).toBe('aborted');
  });
});
