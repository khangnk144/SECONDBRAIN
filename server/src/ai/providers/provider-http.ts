/**
 * One HTTP POST to a provider with the timeouts of SPEC F33 (30 s to the first byte of the body,
 * 120 s in total, plus the caller's signal) and the error mapping every provider shares. Errors
 * carry a reason and the HTTP status only: never the provider's response text, the key or the
 * prompt (they may contain note text or secrets, and errors end up in logs and responses).
 */
import { AiError } from '../ai-types.js';
import type { ProviderCall, ProviderErrorReason, ProviderTimers } from './provider-types.js';

export const FIRST_BYTE_TIMEOUT_MS = 30_000;
export const TOTAL_TIMEOUT_MS = 120_000;
/** Error bodies are read only to tell quota from rate limits; never kept. */
const ERROR_BODY_LIMIT = 8 * 1024;

const nodeTimers: ProviderTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

export function providerError(reason: ProviderErrorReason, status: number | null = null): AiError {
  const message =
    reason === 'aborted' ? 'The AI request was cancelled.' : `The AI provider failed (${reason}).`;
  return new AiError('AI_PROVIDER_ERROR', message, { reason, status });
}

export function isAbortedError(error: unknown): boolean {
  return error instanceof AiError && error.details?.reason === 'aborted';
}

/** Billing problems (no credit, quota used up) are not worth retrying soon, unlike rate limits. */
const QUOTA_HINT = /insufficient_quota|billing|credit balance|payment/i;

export function reasonForStatus(status: number, errorText = ''): ProviderErrorReason {
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'quota';
  if (status === 429) return QUOTA_HINT.test(errorText) ? 'quota' : 'rate-limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (status === 400 && QUOTA_HINT.test(errorText)) return 'quota';
  return 'bad-request';
}

export interface ProviderResponse {
  /** Body bytes; the first-byte timer stops at the first chunk. Errors are `AiError`s. */
  body: AsyncIterable<Uint8Array>;
  /** Clears the timers; call it when done with the body (also after an error). */
  close(): void;
}

/** Sends the request; resolves once a 2xx answer arrived, else throws `AI_PROVIDER_ERROR`. */
export async function postToProvider(
  call: ProviderCall,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<ProviderResponse> {
  if (call.signal?.aborted) throw providerError('aborted');
  const timers = call.timers ?? nodeTimers;
  const controller = new AbortController();
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    controller.abort();
  };
  const onCallerAbort = () => controller.abort();
  call.signal?.addEventListener('abort', onCallerAbort, { once: true });
  let firstByte: unknown = timers.setTimeout(expire, FIRST_BYTE_TIMEOUT_MS);
  const total = timers.setTimeout(expire, TOTAL_TIMEOUT_MS);
  const close = () => {
    if (firstByte !== null) timers.clearTimeout(firstByte);
    firstByte = null;
    timers.clearTimeout(total);
    call.signal?.removeEventListener('abort', onCallerAbort);
  };
  const failure = (): AiError =>
    providerError(timedOut ? 'timeout' : call.signal?.aborted ? 'aborted' : 'network');

  let response: Response;
  try {
    response = await call.fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    close();
    throw failure();
  }

  async function* read(): AsyncGenerator<Uint8Array> {
    if (!response.body) throw providerError('malformed', response.status);
    const reader = response.body.getReader();
    let rejectOnAbort: (error: Error) => void = () => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectOnAbort = reject;
    });
    aborted.catch(() => undefined);
    const onAbort = () => rejectOnAbort(failure());
    if (controller.signal.aborted) onAbort();
    controller.signal.addEventListener('abort', onAbort, { once: true });
    try {
      for (;;) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await Promise.race([reader.read(), aborted]);
        } catch (error) {
          throw error instanceof AiError ? error : failure();
        }
        if (result.done) return;
        if (firstByte !== null) {
          timers.clearTimeout(firstByte);
          firstByte = null;
        }
        yield result.value;
      }
    } finally {
      controller.signal.removeEventListener('abort', onAbort);
      reader.cancel().catch(() => undefined);
    }
  }

  if (!response.ok) {
    const text = await readText(read(), ERROR_BODY_LIMIT).catch(() => '');
    close();
    throw providerError(reasonForStatus(response.status, text), response.status);
  }
  return { body: read(), close };
}

/** Reads the body as UTF-8 text up to `limit` bytes (the rest is dropped). */
export async function readText(body: AsyncIterable<Uint8Array>, limit: number): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    text += decoder.decode(chunk, { stream: true });
    if (size >= limit) break;
  }
  return text + decoder.decode();
}

/** Reads a whole JSON body (embeddings); a broken or oversized body is `malformed`. */
export async function readJson(response: ProviderResponse, limit: number): Promise<unknown> {
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > limit) throw providerError('malformed');
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw providerError('malformed');
  }
}

/** Parses one SSE `data:` payload; anything but a JSON object is `malformed`. */
export function parseEventJson(data: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw providerError('malformed');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw providerError('malformed');
  return value as Record<string, unknown>;
}

/** Non-negative integer field or 0 (usage numbers). */
export function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
