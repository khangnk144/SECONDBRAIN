/**
 * Google Gemini: `streamGenerateContent?alt=sse` for chat, `batchEmbedContents` for embeddings.
 */
import type { ChatRequest, ChatStreamEvent } from '../ai-types.js';
import {
  asRecord,
  count,
  parseEventJson,
  postToProvider,
  providerError,
  readJson,
  reasonForStatus,
} from './provider-http.js';
import type {
  ChatProviderModule,
  EmbedProviderModule,
  EmbedResult,
  ProviderCall,
} from './provider-types.js';
import { parseSse } from './sse-parser.js';
import { estimateTextTokens, toUnitVectors } from './vector-math.js';

const EMBED_RESPONSE_LIMIT = 32 * 1024 * 1024;

/** `models/x` and `x` both name model x; the URL needs the bare id. */
const modelId = (model: string): string => model.replace(/^models\//, '');

export function geminiChatBody(request: ChatRequest): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: request.messages.map(({ role, content }) => ({
      role: role === 'assistant' ? 'model' : 'user',
      parts: [{ text: content }],
    })),
    generationConfig: {
      maxOutputTokens: request.maxTokens,
      ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
      ...(request.json ? { responseMimeType: 'application/json' } : {}),
    },
  };
}

async function* streamChat(
  call: ProviderCall,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const response = await postToProvider(
    call,
    `${call.baseUrl}/v1beta/models/${encodeURIComponent(modelId(call.model))}:streamGenerateContent?alt=sse`,
    { 'x-goog-api-key': call.key, 'content-type': 'application/json' },
    geminiChatBody(request),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  let chunks = 0;
  try {
    for await (const message of parseSse(response.body)) {
      const chunk = parseEventJson(message.data);
      chunks += 1;
      if (chunk.error !== undefined) {
        const code = asRecord(chunk.error).code;
        throw providerError(typeof code === 'number' ? reasonForStatus(code) : 'server');
      }
      const candidate = asRecord(Array.isArray(chunk.candidates) ? chunk.candidates[0] : undefined);
      const parts = asRecord(candidate.content).parts;
      for (const part of Array.isArray(parts) ? parts.map(asRecord) : []) {
        // Thought summaries are not part of the answer.
        if (part.thought === true) continue;
        if (typeof part.text === 'string' && part.text !== '')
          yield { type: 'delta', text: part.text };
      }
      if (typeof candidate.finishReason === 'string') stopReason = candidate.finishReason;
      const blocked = asRecord(chunk.promptFeedback).blockReason;
      if (typeof blocked === 'string') stopReason = blocked;
      if (chunk.usageMetadata) {
        const usage = asRecord(chunk.usageMetadata);
        inputTokens = count(usage.promptTokenCount);
        // Thinking tokens are billed as output.
        outputTokens = count(usage.candidatesTokenCount) + count(usage.thoughtsTokenCount);
      }
    }
    // Gemini has no end marker: the stream simply ends. Nothing at all means a broken answer.
    if (chunks === 0) throw providerError('malformed');
    yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason };
  } finally {
    response.close();
  }
}

async function embed(
  call: ProviderCall,
  texts: readonly string[],
  dims: number,
): Promise<EmbedResult> {
  const id = modelId(call.model);
  const response = await postToProvider(
    call,
    `${call.baseUrl}/v1beta/models/${encodeURIComponent(id)}:batchEmbedContents`,
    { 'x-goog-api-key': call.key, 'content-type': 'application/json' },
    {
      requests: texts.map((text) => ({
        model: `models/${id}`,
        content: { parts: [{ text }] },
        outputDimensionality: dims,
      })),
    },
  );
  try {
    const body = asRecord(await readJson(response, EMBED_RESPONSE_LIMIT));
    const embeddings = Array.isArray(body.embeddings) ? body.embeddings.map(asRecord) : [];
    if (embeddings.length !== texts.length) throw providerError('malformed');
    const vectors = toUnitVectors(
      embeddings.map((item) => (Array.isArray(item.values) ? item.values : undefined)),
      dims,
    );
    // batchEmbedContents reports no usage: count it like the budget estimate.
    return { vectors, usage: { inputTokens: estimateTextTokens(texts), outputTokens: 0 } };
  } finally {
    response.close();
  }
}

export const geminiProvider: ChatProviderModule & EmbedProviderModule = { streamChat, embed };
