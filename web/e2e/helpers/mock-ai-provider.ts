// A local stand-in for the AI providers (SPEC §11 "AI pipeline with a mocked provider"): one
// `http` server on 127.0.0.1 that speaks the Anthropic Messages SSE format (`POST /v1/messages`)
// and the OpenAI embeddings format (`POST /v1/embeddings`), scripted per test and recording every
// request it receives. The app reaches it only through `SB_AI_*_URL` (aiEnv), so no request of
// an AI spec can leave the machine. Ports 47690–47699 only.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  anthropicDelta,
  anthropicEnd,
  anthropicStart,
  mockEmbedding,
  promptKind,
  splitChunks,
  type PromptKind,
} from './mock-ai-formats.js';

export interface ChatReply {
  /** The streamed pieces of the answer. */
  chunks: string[];
  /** Send only this many pieces, then keep the stream open until the client goes away. */
  holdAfter?: number;
  /** Pause between pieces (ms). */
  delayMs?: number;
  /** Answer with this HTTP status and an Anthropic error body instead. */
  status?: number;
}

export interface RecordedRequest {
  path: string;
  kind: PromptKind | 'embeddings' | 'unknown';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  /** System prompt (chat) – empty for embeddings. */
  system: string;
  /** Text of the last user message (chat) or the joined inputs (embeddings). */
  user: string;
}

type Script = string | ChatReply | ((request: RecordedRequest) => string | ChatReply);

const DEFAULT_REPLIES: Partial<Record<PromptKind, string>> = {
  intent: '{"kind":"text","from":null,"to":null,"overdue":false,"about":[]}',
  intro: 'Tuần này bạn có vài việc cần để ý.',
  answer: 'Ghi chú của bạn nói về điều này [S1].',
  today: 'Hôm nay bạn có vài việc nhẹ nhàng.',
  summarize: 'Đoạn này nói ngắn gọn về ý chính.',
  improve: 'Đoạn văn đã được viết lại cho rõ hơn.',
  explain: 'Đoạn này giải thích một ý đơn giản.',
  links: '{"links":[]}',
  tags: '{"tags":[]}',
  placement: '{"folder":"0 Inbox","title":"Ghi chú","reason":"Chưa rõ.","keep":true}',
};

export interface MockAiProvider {
  readonly origin: string;
  /** Every request so far, oldest first. */
  readonly requests: RecordedRequest[];
  /** Streams held open (`holdAfter`) that the client closed before the end. */
  readonly closedEarly: number;
  /** Messages of scripts that threw (each answered 500); a test expects it to stay empty. */
  readonly failures: string[];
  /** Replies for one prompt kind (a function sees the request); later calls replace earlier ones. */
  reply(kind: PromptKind, script: Script): void;
  requestsOf(kind: RecordedRequest['kind']): RecordedRequest[];
  /** Every embeddings answer waits this long (to watch the progress). */
  delayEmbeddings(ms: number): void;
  /** Forgets recorded requests and scripted replies. */
  reset(): void;
  close(): Promise<void>;
}

const lastUserText = (messages: unknown): string => {
  if (!Array.isArray(messages)) return '';
  const users = messages.filter((m) => (m as { role?: string }).role === 'user');
  const content = (users.at(-1) as { content?: unknown } | undefined)?.content;
  return typeof content === 'string' ? content : JSON.stringify(content ?? '');
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function startMockAiProvider(port: number): Promise<MockAiProvider> {
  if (port < 47690 || port > 47699) throw new Error(`port ${port} is outside 47690–47699`);
  const requests: RecordedRequest[] = [];
  const failures: string[] = [];
  const scripts = new Map<PromptKind, Script>();
  const open = new Set<ServerResponse>();
  let closedEarly = 0;
  let embedDelayMs = 0;

  async function streamChat(recorded: RecordedRequest, response: ServerResponse) {
    const script =
      scripts.get(recorded.kind as PromptKind) ??
      DEFAULT_REPLIES[recorded.kind as PromptKind] ??
      'OK';
    const resolved = typeof script === 'function' ? script(recorded) : script;
    const reply: ChatReply =
      typeof resolved === 'string' ? { chunks: splitChunks(resolved) } : resolved;
    if (reply.status) {
      response.writeHead(reply.status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'mock' } }),
      );
      return;
    }
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    response.write(anthropicStart(String(recorded.body.model), 100));
    const sent = reply.holdAfter ?? reply.chunks.length;
    for (const chunk of reply.chunks.slice(0, sent)) {
      if (reply.delayMs) await wait(reply.delayMs);
      response.write(anthropicDelta(chunk));
    }
    if (reply.holdAfter !== undefined) {
      // Held open: the test presses "Dừng"; the app must close this connection.
      open.add(response);
      response.once('close', () => {
        if (open.delete(response)) closedEarly += 1;
      });
      return;
    }
    response.end(anthropicEnd(reply.chunks.join('').length));
  }

  async function embed(recorded: RecordedRequest, response: ServerResponse) {
    if (embedDelayMs > 0) await wait(embedDelayMs);
    const inputs: string[] = Array.isArray(recorded.body.input) ? recorded.body.input : [];
    const dims = Number(recorded.body.dimensions) || 512;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        object: 'list',
        model: recorded.body.model,
        data: inputs.map((text, index) => ({
          object: 'embedding',
          index,
          embedding: mockEmbedding(text, dims),
        })),
        usage: { prompt_tokens: inputs.length * 20, total_tokens: inputs.length * 20 },
      }),
    );
  }

  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? '').split('?')[0]!;
      const text = await readBody(request);
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      const b = (body ?? {}) as Record<string, unknown>;
      const system = typeof b.system === 'string' ? b.system : '';
      const embeddings = path === '/v1/embeddings';
      const recorded: RecordedRequest = {
        path,
        kind: embeddings ? 'embeddings' : path === '/v1/messages' ? promptKind(system) : 'unknown',
        body,
        system,
        user: embeddings
          ? ([] as string[]).concat((b.input as string[]) ?? []).join('\n')
          : lastUserText(b.messages),
      };
      requests.push(recorded);
      if (request.method === 'POST' && path === '/v1/messages')
        return streamChat(recorded, response);
      if (request.method === 'POST' && embeddings) return embed(recorded, response);
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"not mocked"}');
    })().catch((error: unknown) => {
      // A script that throws (a test's own check) answers 500 and is reported by `failures`.
      failures.push(error instanceof Error ? error.message : String(error));
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{"type":"error","error":{"type":"api_error","message":"mock script failed"}}');
    });
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    failures,
    get closedEarly() {
      return closedEarly;
    },
    reply: (kind, script) => void scripts.set(kind, script),
    requestsOf: (kind) => requests.filter((r) => r.kind === kind),
    delayEmbeddings(ms) {
      embedDelayMs = ms;
    },
    reset() {
      requests.length = 0;
      failures.length = 0;
      scripts.clear();
      embedDelayMs = 0;
    },
    async close() {
      for (const response of open) response.destroy();
      open.clear();
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}

/** Environment for an app server whose every AI provider is the mock (nothing leaves the machine). */
export function aiEnv(mock: Pick<MockAiProvider, 'origin'>): Record<string, string> {
  return {
    SB_AI_ANTHROPIC_URL: mock.origin,
    SB_AI_OPENAI_URL: mock.origin,
    SB_AI_GEMINI_URL: mock.origin,
  };
}
