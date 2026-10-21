import { describe, expect, it } from 'vitest';
import { AiError } from '../../../src/ai/ai-types.js';
import { geminiProvider } from '../../../src/ai/providers/gemini-provider.js';
import { openAiProvider } from '../../../src/ai/providers/openai-provider.js';
import type { ProviderCall } from '../../../src/ai/providers/provider-types.js';
import { byteChunks, jsonResponse, recordingFetch, TEST_KEYS } from './provider-test-kit.js';

const texts = ['Đại số tuyến tính – ma trận', 'Xác suất thống kê', 'Nấu ăn'];
const norm = (v: Float32Array) => Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));

describe('embedding providers (F33 retrieval)', () => {
  it('openai: request shape, input order restored, unit vectors, reported usage', async () => {
    const recorder = recordingFetch(
      () =>
        new Response(
          // Out of order on purpose, and cut into 5-byte chunks.
          new Blob(
            byteChunks(
              JSON.stringify({
                data: [
                  { index: 2, embedding: [0, 0, 3, 4] },
                  { index: 0, embedding: [2, 0, 0, 0] },
                  { index: 1, embedding: [0, 1, 1, 0] },
                ],
                usage: { prompt_tokens: 21, total_tokens: 21 },
              }),
              5,
            ),
          ).stream(),
        ),
    );
    const call: ProviderCall = {
      baseUrl: 'https://api.openai.com',
      model: 'text-embedding-3-small',
      key: TEST_KEYS.openai,
      fetch: recorder.fetch,
    };
    const result = await openAiProvider.embed(call, texts, 4);
    const [sent] = recorder.requests;
    expect(sent!.url).toBe('https://api.openai.com/v1/embeddings');
    expect(sent!.headers.authorization).toBe(`Bearer ${TEST_KEYS.openai}`);
    expect(sent!.body).toEqual({ model: 'text-embedding-3-small', input: texts, dimensions: 4 });
    expect(Array.from(result.vectors[0]!)).toEqual([1, 0, 0, 0]);
    expect(result.vectors[2]![2]).toBeCloseTo(0.6);
    for (const vector of result.vectors) expect(norm(vector)).toBeCloseTo(1, 5);
    expect(result.usage).toEqual({ inputTokens: 21, outputTokens: 0 });
  });

  it('gemini: batchEmbedContents shape, normalized vectors, estimated usage', async () => {
    const recorder = recordingFetch(() =>
      jsonResponse({ embeddings: texts.map((_, i) => ({ values: [i + 1, 1, 0] })) }),
    );
    const result = await geminiProvider.embed(
      {
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-embedding-001',
        key: TEST_KEYS.gemini,
        fetch: recorder.fetch,
      },
      texts,
      3,
    );
    const [sent] = recorder.requests;
    expect(sent!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
    );
    expect(sent!.headers['x-goog-api-key']).toBe(TEST_KEYS.gemini);
    expect(sent!.body).toEqual({
      requests: texts.map((text) => ({
        model: 'models/gemini-embedding-001',
        content: { parts: [{ text }] },
        outputDimensionality: 3,
      })),
    });
    for (const vector of result.vectors) expect(norm(vector)).toBeCloseTo(1, 5);
    const characters = texts.join('').length;
    expect(result.usage.inputTokens).toBe(Math.ceil(characters / 4));
  });

  it.each([
    ['a missing vector', { data: [{ index: 0, embedding: [1, 0] }] }],
    ['a wrong size', { data: texts.map((_, index) => ({ index, embedding: [1, 0, 0] })) }],
    ['a non-number', { data: texts.map((_, index) => ({ index, embedding: [1, 'x'] })) }],
    ['a duplicate index', { data: texts.map(() => ({ index: 0, embedding: [1, 0] })) }],
  ])('openai: %s → malformed', async (_label, body) => {
    const recorder = recordingFetch(() => jsonResponse(body));
    const error = await openAiProvider
      .embed(
        { baseUrl: 'https://x.test', model: 'm', key: TEST_KEYS.openai, fetch: recorder.fetch },
        texts,
        2,
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).details).toEqual({ reason: 'malformed', status: null });
  });

  it('gemini: HTTP 429 → rate-limit, 403 → auth', async () => {
    for (const [status, reason] of [
      [429, 'rate-limit'],
      [403, 'auth'],
    ] as const) {
      const recorder = recordingFetch(() => jsonResponse({ error: { code: status } }, status));
      const error = (await geminiProvider
        .embed(
          { baseUrl: 'https://x.test', model: 'm', key: TEST_KEYS.gemini, fetch: recorder.fetch },
          texts,
          2,
        )
        .catch((e: unknown) => e)) as AiError;
      expect(error.details).toEqual({ reason, status });
    }
  });
});
