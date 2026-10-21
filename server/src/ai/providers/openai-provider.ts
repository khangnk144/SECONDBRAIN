/**
 * OpenAI Chat Completions (streamed, usage in the last chunk) and Embeddings.
 */
import type { ChatRequest, ChatStreamEvent } from '../ai-types.js';
import { JSON_ONLY_INSTRUCTION } from './anthropic-provider.js';
import {
  asRecord,
  count,
  parseEventJson,
  postToProvider,
  providerError,
  readJson,
} from './provider-http.js';
import type {
  ChatProviderModule,
  EmbedProviderModule,
  EmbedResult,
  ProviderCall,
  ProviderErrorReason,
} from './provider-types.js';
import { parseSse } from './sse-parser.js';
import { estimateTextTokens, toUnitVectors } from './vector-math.js';

/**
 * GPT-5-family models reason before answering and accept only the default temperature; their
 * reasoning tokens count against `max_completion_tokens`, so short calls (the intent step) ask
 * for minimal reasoning or the whole allowance could go to thinking.
 */
const REASONING_MODEL = /^(gpt-5|o\d)/i;
const MINIMAL_REASONING_MODEL = /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/i;
const EMBED_RESPONSE_LIMIT = 32 * 1024 * 1024;

export function openAiChatBody(model: string, request: ChatRequest): Record<string, unknown> {
  // JSON mode requires the word "JSON" somewhere in the messages.
  const system =
    request.json && !/json/i.test(request.system)
      ? `${request.system}\n\n${JSON_ONLY_INSTRUCTION}`
      : request.system;
  const reasoning = REASONING_MODEL.test(model);
  return {
    model,
    messages: [
      { role: 'system', content: system },
      ...request.messages.map(({ role, content }) => ({ role, content })),
    ],
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: request.maxTokens,
    ...(request.temperature === undefined || reasoning ? {} : { temperature: request.temperature }),
    ...(MINIMAL_REASONING_MODEL.test(model) ? { reasoning_effort: 'minimal' } : {}),
    ...(request.json ? { response_format: { type: 'json_object' } } : {}),
  };
}

function streamErrorReason(error: Record<string, unknown>): ProviderErrorReason {
  const code = `${String(error.code ?? '')} ${String(error.type ?? '')}`;
  if (/insufficient_quota/.test(code)) return 'quota';
  if (/rate_limit/.test(code)) return 'rate-limit';
  if (/invalid_api_key|authentication/.test(code)) return 'auth';
  if (/invalid_request/.test(code)) return 'bad-request';
  return 'server';
}

async function* streamChat(
  call: ProviderCall,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const response = await postToProvider(
    call,
    `${call.baseUrl}/v1/chat/completions`,
    { authorization: `Bearer ${call.key}`, 'content-type': 'application/json' },
    openAiChatBody(call.model, request),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  try {
    for await (const message of parseSse(response.body)) {
      if (message.data.trim() === '[DONE]') {
        yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason };
        return;
      }
      const chunk = parseEventJson(message.data);
      if (chunk.error !== undefined) throw providerError(streamErrorReason(asRecord(chunk.error)));
      const usage = asRecord(chunk.usage);
      if (chunk.usage) {
        inputTokens = count(usage.prompt_tokens);
        outputTokens = count(usage.completion_tokens);
      }
      const choice = asRecord(Array.isArray(chunk.choices) ? chunk.choices[0] : undefined);
      const content = asRecord(choice.delta).content;
      if (typeof content === 'string' && content !== '') yield { type: 'delta', text: content };
      if (typeof choice.finish_reason === 'string') stopReason = choice.finish_reason;
    }
    throw providerError('malformed'); // no `[DONE]`: possibly cut off
  } finally {
    response.close();
  }
}

async function embed(
  call: ProviderCall,
  texts: readonly string[],
  dims: number,
): Promise<EmbedResult> {
  const response = await postToProvider(
    call,
    `${call.baseUrl}/v1/embeddings`,
    { authorization: `Bearer ${call.key}`, 'content-type': 'application/json' },
    { model: call.model, input: [...texts], dimensions: dims },
  );
  try {
    const body = asRecord(await readJson(response, EMBED_RESPONSE_LIMIT));
    const data = Array.isArray(body.data) ? body.data.map(asRecord) : [];
    if (data.length !== texts.length) throw providerError('malformed');
    const ordered: number[][] = new Array<number[]>(texts.length);
    for (const [position, item] of data.entries()) {
      const index = typeof item.index === 'number' ? item.index : position;
      if (!Array.isArray(item.embedding) || ordered[index] !== undefined)
        throw providerError('malformed');
      ordered[index] = item.embedding as number[];
    }
    const vectors = toUnitVectors(ordered, dims);
    const usage = asRecord(body.usage);
    const tokens =
      count(usage.prompt_tokens) || count(usage.total_tokens) || estimateTextTokens(texts);
    return { vectors, usage: { inputTokens: tokens, outputTokens: 0 } };
  } finally {
    response.close();
  }
}

export const openAiProvider: ChatProviderModule & EmbedProviderModule = { streamChat, embed };
