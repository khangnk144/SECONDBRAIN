/**
 * Test helpers for the chat: a scripted `POST /api/ai/chat` SSE stream on top of the fetch mock
 * (the real `streamAiChat` parses it), AI status fixtures and a clean state per test.
 */
import { vi } from 'vitest';
import type { AiChatEvent, AiChatRequest, AiStatus } from '../../lib/api/ai-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { resetChatSending } from './chat-send';
import { resetChatStore } from './chat-store';

export function aiStatus(overrides: Partial<AiStatus> = {}): AiStatus {
  return {
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
      consented: false,
      provider: 'openai',
      model: 'text-embedding-3-small',
      hasKey: false,
      state: 'off',
      done: 0,
      total: 0,
      pending: 0,
      lastError: null,
    },
    usage: { month: '2026-10', tokens: 1530, limit: 2_000_000, paused: false },
    scope: ['', '0 Inbox', '1 Projects', '2 Areas', 'Daily', 'wiki'],
    ...overrides,
  };
}

export function setAiStatus(status: AiStatus | null): void {
  useAiStatusStore.setState({ status });
}

export interface ScriptedChat {
  /** Bodies of every chat request, in order. */
  requests: AiChatRequest[];
  /** The abort signal of each request. */
  signals: AbortSignal[];
  /** Sends one event on the latest stream. */
  send: (event: AiChatEvent) => void;
  /** Ends the latest stream. */
  end: () => void;
  /** The next request is refused before the stream with this JSON error. */
  refuseNext: (status: number, code: string, details?: Record<string, unknown>) => void;
}

export function installChatStream(): ScriptedChat {
  const inner = globalThis.fetch;
  const encoder = new TextEncoder();
  let current: ReadableStreamDefaultController<Uint8Array> | null = null;
  let refusal: { status: number; code: string; details?: Record<string, unknown> } | null = null;
  const chat: ScriptedChat = {
    requests: [],
    signals: [],
    send: ({ type, ...payload }) =>
      current?.enqueue(encoder.encode(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`)),
    end: () => current?.close(),
    refuseNext: (status, code, details) => {
      refusal = { status, code, details };
    },
  };
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) !== '/api/ai/chat') return inner(input, init);
    chat.requests.push(JSON.parse(String(init?.body)) as AiChatRequest);
    if (init?.signal) chat.signals.push(init.signal);
    if (refusal) {
      const { status, code, details } = refusal;
      refusal = null;
      return new Response(JSON.stringify({ error: { code, message: code, details } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        current = controller;
        init?.signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        );
      },
    });
    return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  });
  return chat;
}

/** Fresh app state, a fetch mock, a ready AI status and a scripted chat stream. */
export async function setUpChat(
  status: AiStatus | null = aiStatus(),
): Promise<{ mock: FetchMock; chat: ScriptedChat }> {
  await resetAppState();
  resetChatSending();
  resetChatStore();
  const mock = installFetchMock();
  mock.on('GET /api/ai/status', { body: status ?? aiStatus() });
  setAiStatus(status);
  return { mock, chat: installChatStream() };
}

type MetaEvent = Extract<AiChatEvent, { type: 'meta' }>;
type DoneEvent = Extract<AiChatEvent, { type: 'done' }>;

export const meta = (overrides: Partial<MetaEvent> = {}): MetaEvent => ({
  type: 'meta',
  kind: 'text',
  retrieval: 'bm25',
  sources: [],
  ...overrides,
});

export const done = (overrides: Partial<DoneEvent> = {}): DoneEvent => ({
  type: 'done',
  answer: '',
  citations: [],
  rejected: [],
  notices: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  ...overrides,
});
