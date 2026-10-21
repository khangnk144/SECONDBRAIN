import { describe, expect, it } from 'vitest';
import type { ChatRequest, ChatStreamEvent } from '../../../src/ai/ai-types.js';
import { anthropicProvider } from '../../../src/ai/providers/anthropic-provider.js';
import {
  DEFAULT_CHAT_MODELS,
  DEFAULT_EMBEDDING_MODELS,
} from '../../../src/ai/providers/default-models.js';
import { geminiProvider } from '../../../src/ai/providers/gemini-provider.js';
import { openAiProvider } from '../../../src/ai/providers/openai-provider.js';
import { providerBaseUrl } from '../../../src/ai/providers/provider-endpoints.js';
import type { ProviderCall } from '../../../src/ai/providers/provider-types.js';
import {
  byteChunks,
  recordingFetch,
  sseEvents,
  sseResponse,
  TEST_KEYS,
  type Responder,
} from './provider-test-kit.js';

const ANSWER = 'Đại số tuyến tính – chương 3 nói về ma trận. 😀';
const request: ChatRequest = {
  purpose: 'chat',
  system: 'Bạn là trợ lý.',
  messages: [
    { role: 'user', content: 'Ma trận là gì?' },
    { role: 'assistant', content: 'Một bảng số.' },
    { role: 'user', content: 'Cho ví dụ.' },
  ],
  maxTokens: 500,
  temperature: 0.2,
};

async function collect(stream: AsyncIterable<ChatStreamEvent>) {
  let text = '';
  const done: ChatStreamEvent[] = [];
  for await (const event of stream) {
    if (event.type === 'delta') text += event.text;
    else done.push(event);
  }
  return { text, done };
}

function call(fetch: ProviderCall['fetch'], key: string, model: string, baseUrl: string) {
  return { baseUrl, model, key, fetch };
}

const anthropicStream = sseEvents(
  [
    { type: 'message_start', message: { usage: { input_tokens: 42, output_tokens: 1 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'ping' },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Đại số tuyến tính – ' },
    },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'chương 3 nói về ma trận. 😀' },
    },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 17 } },
    { type: 'message_stop' },
  ],
  { named: true },
);

const openAiStream =
  sseEvents([
    { choices: [{ index: 0, delta: { role: 'assistant', content: '' } }] },
    { choices: [{ index: 0, delta: { content: 'Đại số tuyến tính – ' } }] },
    { choices: [{ index: 0, delta: { content: 'chương 3 nói về ma trận. 😀' } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { choices: [], usage: { prompt_tokens: 40, completion_tokens: 15 } },
  ]) + 'data: [DONE]\n\n';

const geminiStream = sseEvents([
  { candidates: [{ content: { role: 'model', parts: [{ text: 'Đại số tuyến tính – ' }] } }] },
  {
    candidates: [
      {
        content: {
          parts: [{ text: 'thinking…', thought: true }, { text: 'chương 3 nói về ma trận. 😀' }],
        },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 38, candidatesTokenCount: 12, thoughtsTokenCount: 3 },
  },
]).replace(/\n\n/g, '\r\n\r\n');

describe('chat providers: request shape and streaming (F33)', () => {
  const cases = [
    {
      name: 'anthropic',
      provider: anthropicProvider,
      key: TEST_KEYS.anthropic,
      model: DEFAULT_CHAT_MODELS.anthropic,
      base: providerBaseUrl('anthropic', {}),
      stream: anthropicStream,
      usage: { inputTokens: 42, outputTokens: 17 },
      stop: 'end_turn',
    },
    {
      name: 'openai',
      provider: openAiProvider,
      key: TEST_KEYS.openai,
      model: DEFAULT_CHAT_MODELS.openai,
      base: providerBaseUrl('openai', {}),
      stream: openAiStream,
      usage: { inputTokens: 40, outputTokens: 15 },
      stop: 'stop',
    },
    {
      name: 'gemini',
      provider: geminiProvider,
      key: TEST_KEYS.gemini,
      model: DEFAULT_CHAT_MODELS.gemini,
      base: providerBaseUrl('gemini', {}),
      stream: geminiStream,
      usage: { inputTokens: 38, outputTokens: 15 },
      stop: 'STOP',
    },
  ] as const;

  it.each(cases)('$name: text and usage, whatever the chunk boundaries', async (c) => {
    for (const size of [1, 3, 7, 64, 100_000]) {
      const recorder = recordingFetch(() => sseResponse(byteChunks(c.stream, size)));
      const result = await collect(
        c.provider.streamChat(call(recorder.fetch, c.key, c.model, c.base), request),
      );
      expect(result.text, `${c.name} chunks of ${size}`).toBe(ANSWER);
      expect(result.done).toEqual([{ type: 'done', usage: c.usage, stopReason: c.stop }]);
    }
  });

  it('anthropic: URL, headers with the key, body; JSON only through the system prompt', async () => {
    const recorder = recordingFetch(() => sseResponse([anthropicStream]));
    const base = 'https://api.anthropic.com';
    await collect(
      anthropicProvider.streamChat(
        call(recorder.fetch, TEST_KEYS.anthropic, 'claude-x', base),
        request,
      ),
    );
    await collect(
      anthropicProvider.streamChat(call(recorder.fetch, TEST_KEYS.anthropic, 'claude-x', base), {
        ...request,
        json: true,
        temperature: undefined,
      }),
    );
    const [plain, json] = recorder.requests;
    expect(plain!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(plain!.method).toBe('POST');
    expect(plain!.headers).toMatchObject({
      'x-api-key': TEST_KEYS.anthropic,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    });
    expect(plain!.body).toEqual({
      model: 'claude-x',
      max_tokens: 500,
      system: 'Bạn là trợ lý.',
      messages: request.messages,
      stream: true,
      temperature: 0.2,
    });
    expect(json!.body.system).toMatch(/^Bạn là trợ lý\.\n\n.*JSON object/);
    expect(json!.body).not.toHaveProperty('temperature');
    expect(json!.body).not.toHaveProperty('response_format');
  });

  it('openai: Bearer key, system message first, usage requested, JSON mode flag', async () => {
    const recorder = recordingFetch(() => sseResponse([openAiStream]));
    const base = 'https://api.openai.com';
    await collect(
      openAiProvider.streamChat(
        call(recorder.fetch, TEST_KEYS.openai, 'gpt-4.1-mini', base),
        request,
      ),
    );
    await collect(
      openAiProvider.streamChat(call(recorder.fetch, TEST_KEYS.openai, 'gpt-5-mini', base), {
        ...request,
        json: true,
      }),
    );
    const [plain, json] = recorder.requests;
    expect(plain!.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(plain!.headers).toMatchObject({ authorization: `Bearer ${TEST_KEYS.openai}` });
    expect(plain!.body).toEqual({
      model: 'gpt-4.1-mini',
      messages: [{ role: 'system', content: 'Bạn là trợ lý.' }, ...request.messages],
      stream: true,
      stream_options: { include_usage: true },
      max_completion_tokens: 500,
      temperature: 0.2,
    });
    // GPT-5 models take no temperature and get minimal reasoning; JSON needs the word JSON.
    expect(json!.body).toMatchObject({
      model: 'gpt-5-mini',
      response_format: { type: 'json_object' },
      reasoning_effort: 'minimal',
    });
    expect(json!.body).not.toHaveProperty('temperature');
    expect(json!.body.messages[0].content).toMatch(/JSON/);
  });

  it('gemini: key header, model in the URL, system instruction, roles, JSON mime type', async () => {
    const recorder = recordingFetch(() => sseResponse([geminiStream]));
    const base = 'https://generativelanguage.googleapis.com';
    await collect(
      geminiProvider.streamChat(call(recorder.fetch, TEST_KEYS.gemini, 'models/gemini-x', base), {
        ...request,
        json: true,
      }),
    );
    const [sent] = recorder.requests;
    expect(sent!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse',
    );
    expect(sent!.headers).toMatchObject({ 'x-goog-api-key': TEST_KEYS.gemini });
    expect(sent!.url).not.toContain(TEST_KEYS.gemini);
    expect(sent!.body).toEqual({
      systemInstruction: { parts: [{ text: 'Bạn là trợ lý.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Ma trận là gì?' }] },
        { role: 'model', parts: [{ text: 'Một bảng số.' }] },
        { role: 'user', parts: [{ text: 'Cho ví dụ.' }] },
      ],
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    });
  });

  it('defaults and base URL overrides (SB_AI_*_URL for the end-to-end mock)', () => {
    expect(DEFAULT_CHAT_MODELS).toEqual({
      anthropic: 'claude-haiku-5-5',
      openai: 'gpt-5-mini',
      gemini: 'gemini-3.5-flash-lite',
    });
    expect(DEFAULT_EMBEDDING_MODELS).toEqual({
      openai: { model: 'text-embedding-3-small', dims: 512 },
      gemini: { model: 'gemini-embedding-001', dims: 768 },
    });
    expect(providerBaseUrl('openai', { SB_AI_OPENAI_URL: 'http://127.0.0.1:47731/' })).toBe(
      'http://127.0.0.1:47731',
    );
    expect(providerBaseUrl('gemini', { SB_AI_GEMINI_URL: 'file:///etc/passwd' })).toBe(
      'https://generativelanguage.googleapis.com',
    );
    expect(providerBaseUrl('anthropic', { SB_AI_ANTHROPIC_URL: 'http://localhost:47732' })).toBe(
      'http://localhost:47732',
    );
  });

  it('leaving the loop early cancels the response body', async () => {
    let cancelled = false;
    const responder: Responder = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(anthropicStream.slice(0, 400)));
          },
          cancel() {
            cancelled = true;
          },
        }),
      );
    const recorder = recordingFetch(responder);
    for await (const event of anthropicProvider.streamChat(
      call(recorder.fetch, TEST_KEYS.anthropic, 'm', 'https://x.test'),
      request,
    )) {
      if (event.type === 'delta') break;
    }
    expect(cancelled).toBe(true);
  });
});
