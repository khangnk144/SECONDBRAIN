/**
 * Anthropic Messages API, streamed (`POST /v1/messages` with `stream: true`). Anthropic has no
 * JSON mode: JSON answers are asked for in the system prompt only.
 */
import type { ChatRequest, ChatStreamEvent } from '../ai-types.js';
import { asRecord, count, parseEventJson, postToProvider, providerError } from './provider-http.js';
import type { ChatProviderModule, ProviderCall, ProviderErrorReason } from './provider-types.js';
import { parseSse } from './sse-parser.js';

export const ANTHROPIC_VERSION = '2023-06-01';
export const JSON_ONLY_INSTRUCTION =
  'Answer with exactly one JSON object and nothing else (no code fence, no text around it).';

/** `error.type` of a streamed error event → reason. */
const STREAM_ERROR_REASONS: Readonly<Record<string, ProviderErrorReason>> = {
  authentication_error: 'auth',
  permission_error: 'auth',
  rate_limit_error: 'rate-limit',
  overloaded_error: 'server',
  api_error: 'server',
  invalid_request_error: 'bad-request',
  not_found_error: 'bad-request',
  request_too_large: 'bad-request',
  billing_error: 'quota',
};

export function anthropicRequestBody(model: string, request: ChatRequest): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxTokens,
    system: request.json ? `${request.system}\n\n${JSON_ONLY_INSTRUCTION}` : request.system,
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    stream: true,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
  };
}

async function* streamChat(
  call: ProviderCall,
  request: ChatRequest,
): AsyncGenerator<ChatStreamEvent> {
  const response = await postToProvider(
    call,
    `${call.baseUrl}/v1/messages`,
    {
      'x-api-key': call.key,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    anthropicRequestBody(call.model, request),
  );
  let inputTokens = 0;
  let outputTokens = 0;
  let stopReason: string | null = null;
  try {
    for await (const message of parseSse(response.body)) {
      const event = parseEventJson(message.data);
      switch (event.type) {
        case 'message_start': {
          const usage = asRecord(asRecord(event.message).usage);
          inputTokens = count(usage.input_tokens) + count(usage.cache_read_input_tokens);
          outputTokens = count(usage.output_tokens);
          break;
        }
        case 'content_block_delta': {
          const delta = asRecord(event.delta);
          if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text !== '')
            yield { type: 'delta', text: delta.text };
          break;
        }
        case 'message_delta': {
          const usage = asRecord(event.usage);
          if (usage.output_tokens !== undefined) outputTokens = count(usage.output_tokens);
          const reason = asRecord(event.delta).stop_reason;
          if (typeof reason === 'string') stopReason = reason;
          break;
        }
        case 'message_stop':
          yield { type: 'done', usage: { inputTokens, outputTokens }, stopReason };
          return;
        case 'error': {
          const type = asRecord(event.error).type;
          throw providerError((typeof type === 'string' && STREAM_ERROR_REASONS[type]) || 'server');
        }
        default:
          break; // ping, content_block_start/stop, future event types
      }
    }
    // The stream ended without `message_stop`: the answer may be cut off.
    throw providerError('malformed');
  } finally {
    response.close();
  }
}

export const anthropicProvider: ChatProviderModule = { streamChat };
