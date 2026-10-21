/**
 * A scripted `AiRuntime` for the answer tests: it records every request (the bodies a provider
 * would receive), answers from a script per purpose, and uses the real scope rule, so tests can
 * prove what would and would not leave the machine. It never touches the network.
 */
import { AI_PLUGIN, type VaultPlugin } from '../../../src/app-context/vault-plugins.js';
import {
  AiError,
  type AiPurpose,
  type AiRuntime,
  type AiStatus,
  type ChatRequest,
  type ChatStreamEvent,
  type EmbeddingIndex,
} from '../../../src/ai/ai-types.js';
import { pathInScope } from '../../../src/ai/runtime/ai-scope.js';

/** Text (one delta), chunks (one delta each), an error to throw, or a function of the request. */
export type ScriptedReply =
  | string
  | string[]
  | AiError
  | ((request: ChatRequest) => string | string[] | AiError | Promise<string | string[] | AiError>);

export interface FakeRuntimeOptions {
  replies?: Partial<Record<ChatRequest['purpose'], ScriptedReply>>;
  /** Scope folders as in settings (`null` = default: everything but 3 Resources, 4 Archive). */
  folders?: string[] | null;
  /** Thrown by `assertReady` (and synchronously by `stream`/`complete`). */
  notReady?: AiError | null;
  /** Thrown synchronously by `stream`/`complete` for one purpose (a budget pre-check). */
  refuse?: Partial<Record<ChatRequest['purpose'], AiError>>;
  embeddings?: EmbeddingIndex | null;
  /** Awaited before each streamed delta (lets a test disconnect mid-stream). */
  beforeDelta?: (request: ChatRequest, index: number) => Promise<void>;
}

export interface RecordedRequest extends ChatRequest {
  call: 'stream' | 'complete';
}

export interface FakeAiRuntime extends AiRuntime {
  options: FakeRuntimeOptions;
  requests: RecordedRequest[];
  /** Every text a provider would have received (system + messages), one string per request. */
  sentTexts(): string[];
  readyChecks: AiPurpose[];
}

async function resolveReply(script: ScriptedReply | undefined, request: ChatRequest) {
  const value = typeof script === 'function' ? await script(request) : script;
  if (value instanceof AiError) throw value;
  if (value === undefined) return [''];
  return Array.isArray(value) ? value : [value];
}

const abortedError = () => new AiError('AI_PROVIDER_ERROR', 'aborted', { reason: 'aborted' });

export function createFakeAiRuntime(options: FakeRuntimeOptions = {}): FakeAiRuntime {
  const requests: RecordedRequest[] = [];
  const readyChecks: AiPurpose[] = [];
  const check = (purpose?: ChatRequest['purpose']) => {
    if (options.notReady) throw options.notReady;
    const refusal = purpose ? options.refuse?.[purpose] : undefined;
    if (refusal) throw refusal;
  };
  const runtime: FakeAiRuntime = {
    options,
    requests,
    readyChecks,
    sentTexts: () =>
      requests.map((r) => [r.system, ...r.messages.map((m) => m.content)].join('\n')),
    status: () => ({ ready: !options.notReady }) as AiStatus,
    assertReady(purpose) {
      readyChecks.push(purpose);
      check();
    },
    stream(request): AsyncIterable<ChatStreamEvent> {
      check(request.purpose);
      requests.push({ ...request, call: 'stream' });
      return (async function* () {
        const chunks = await resolveReply(options.replies?.[request.purpose], request);
        let index = 0;
        for (const text of chunks) {
          await options.beforeDelta?.(request, index);
          if (request.signal?.aborted) throw abortedError();
          index += 1;
          yield { type: 'delta', text } as const;
        }
        yield {
          type: 'done',
          usage: { inputTokens: 100, outputTokens: chunks.join('').length },
          stopReason: 'end_turn',
        } as const;
      })();
    },
    async complete(request) {
      check(request.purpose);
      requests.push({ ...request, call: 'complete' });
      const chunks = await resolveReply(options.replies?.[request.purpose], request);
      if (request.signal?.aborted) throw abortedError();
      return { text: chunks.join(''), usage: { inputTokens: 50, outputTokens: 5 } };
    },
    inScope: (path) => pathInScope(path, options.folders ?? null),
    embeddings: () => options.embeddings ?? null,
    rebuildEmbeddings: () => false,
    close: async () => undefined,
  };
  return runtime;
}

export function fakeAiPlugin(runtime: FakeAiRuntime): VaultPlugin<AiRuntime> {
  return { name: AI_PLUGIN, start: async () => runtime };
}
