/**
 * Server-sent events for `POST /api/ai/chat`. The reply is hijacked (Fastify's `onSend` hooks do
 * not run then), so the baseline security headers are written here by hand, with
 * `cache-control: no-store`. Each event is one `event:` line and one `data:` line of JSON
 * (JSON never contains a raw line break).
 */
import type { FastifyReply } from 'fastify';
import { BASELINE_SECURITY_HEADERS } from '../../security/security-headers.js';
import type { PreparedChat } from './chat-types.js';
import { outcomeOf, streamErrorPayload } from './route-support.js';

export interface SseWriter {
  send(event: 'meta' | 'delta' | 'done' | 'error', data: unknown): void;
  end(): void;
}

export function openSse(reply: FastifyReply): SseWriter {
  reply.hijack();
  const raw = reply.raw;
  raw.writeHead(200, {
    ...BASELINE_SECURITY_HEADERS,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-store',
    // Proxies and some browsers buffer streamed bodies unless told otherwise.
    'x-accel-buffering': 'no',
  });
  const open = () => !raw.writableEnded && !raw.destroyed;
  return {
    send(event, data) {
      if (open()) raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (open()) raw.end();
    },
  };
}

/**
 * Aborts when the client goes away before the response finished (a closed panel, a reload),
 * which cancels the provider request through the runtime's `signal`.
 */
export function abortOnDisconnect(reply: FastifyReply): AbortController {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller;
}

/**
 * Streams a prepared chat: `meta`, the `delta`s, then `done` – or `error` when it fails after the
 * stream started (nothing is sent to a client that went away). Resolves with the log outcome.
 */
export async function streamPreparedChat(
  reply: FastifyReply,
  prepared: PreparedChat,
  signal: AbortSignal,
): Promise<{ outcome: string; counts: string }> {
  const { meta } = prepared;
  const counts = `kind=${meta.kind} retrieval=${meta.retrieval} sources=${meta.sources.length}`;
  const sse = openSse(reply);
  sse.send('meta', meta);
  try {
    const done = await prepared.answer((text) => sse.send('delta', { text }));
    sse.send('done', done);
    return { outcome: 'ok', counts: `${counts} citations=${done.citations.length}` };
  } catch (error) {
    if (!signal.aborted) sse.send('error', streamErrorPayload(error));
    return { outcome: outcomeOf(error, signal.aborted), counts };
  } finally {
    sse.end();
  }
}
