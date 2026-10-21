/**
 * Test doubles for the AI providers: a fetch that records every request and answers from a
 * script (never the network), SSE/JSON bodies cut into arbitrary chunks, and manual timers.
 */
import type { FetchLike, ProviderTimers } from '../../../src/ai/providers/provider-types.js';

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The parsed JSON body. */
  body: Record<string, unknown> & { [key: string]: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  rawBody: string;
  signal: AbortSignal | undefined;
}

export type Responder = (request: RecordedRequest, index: number) => Response | Promise<Response>;

export function recordingFetch(respond: Responder = () => new Response('{}')) {
  const requests: RecordedRequest[] = [];
  let responder = respond;
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init.headers ?? {}) as Record<string, string>))
      headers[key.toLowerCase()] = value;
    const rawBody = String(init.body ?? '');
    const request: RecordedRequest = {
      url,
      method: init.method ?? 'GET',
      headers,
      body: rawBody ? JSON.parse(rawBody) : {},
      rawBody,
      signal: init.signal ?? undefined,
    };
    requests.push(request);
    return responder(request, requests.length - 1);
  };
  return {
    fetch,
    requests,
    respondWith(next: Responder) {
      responder = next;
    },
  };
}

const encoder = new TextEncoder();

/** A body that delivers exactly these chunks (strings are UTF-8 encoded). */
export function chunkedBody(chunks: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i++]!;
      controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
    },
  });
}

export function sseResponse(chunks: readonly (string | Uint8Array)[], status = 200): Response {
  return new Response(chunkedBody(chunks), {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/** `data: <json>\n\n` for each event. */
export function sseEvents(events: readonly unknown[], options: { named?: boolean } = {}): string {
  return events
    .map((event) => {
      const type = (event as { type?: string }).type;
      const name = options.named && type ? `event: ${type}\n` : '';
      return `${name}data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`;
    })
    .join('');
}

/** Cuts text (as UTF-8 bytes) into pieces of `size` bytes, splitting characters on purpose. */
export function byteChunks(text: string, size: number): Uint8Array[] {
  const bytes = encoder.encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.slice(i, i + size));
  return out;
}

export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A response that never comes; it rejects like fetch does when its signal aborts. */
export function hangingResponse(request: RecordedRequest): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
    if (request.signal?.aborted) fail();
    request.signal?.addEventListener('abort', fail, { once: true });
  });
}

/** Headers arrive, then the body never sends a byte (until aborted, which fetch would signal). */
export function stalledBodyResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({ pull: () => new Promise(() => undefined) }),
    {
      status: 200,
    },
  );
}

/** Timers driven by hand: `advance(ms)` runs every due callback in time order. */
export class ManualTimers implements ProviderTimers {
  now = 0;
  private seq = 0;
  private readonly tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.now + Math.max(0, ms), callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  get pending(): number {
    return this.tasks.size;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let next: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.tasks) {
        if (entry[1].at > target) continue;
        if (!next || entry[1].at < next[1].at || (entry[1].at === next[1].at && entry[0] < next[0]))
          next = entry;
      }
      if (!next) break;
      this.tasks.delete(next[0]);
      this.now = Math.max(this.now, next[1].at);
      next[1].callback();
    }
    this.now = target;
  }
}

export const TEST_KEYS = {
  anthropic: 'sk-ant-api03-TESTKEYanthropic000000000000-zzzz',
  openai: 'sk-proj-TESTKEYopenai1111111111111111111-yyyy',
  gemini: 'AIzaSyTESTKEYgemini22222222222222222-xxxx',
} as const;
