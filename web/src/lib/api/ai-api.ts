import { api, apiAuthHeaders, notifyVaultSwitched } from '../api';
import { ApiError, isVaultSwitchedError } from '../api-client';
import type {
  AiActionRequest,
  AiChatEvent,
  AiChatRequest,
  AiLinkSuggestions,
  AiPlacementSuggestion,
  AiSearchResponse,
  AiStatus,
  AiTagSuggestions,
  AiTextAction,
  AiTextActionResponse,
  AiTodaySummary,
} from './ai-types';
import type { VaultPath } from './vault-types';

export function getAiStatus(): Promise<AiStatus> {
  return api().get<AiStatus>('/ai/status');
}

export function rebuildEmbeddings(): Promise<{ started: boolean }> {
  return api().request<{ started: boolean }>('/ai/embeddings/rebuild', { method: 'POST' });
}

type ActionResponse<A extends AiActionRequest['action']> = A extends AiTextAction
  ? AiTextActionResponse
  : A extends 'suggest-links'
    ? AiLinkSuggestions
    : A extends 'suggest-tags'
      ? AiTagSuggestions
      : AiPlacementSuggestion;

/**
 * `POST /ai/action`; one call per user click, nothing is changed by it. `signal` aborts the
 * request, and with it the provider call on the server ("Hủy").
 */
export function runAiAction<R extends AiActionRequest>(
  request: R,
  options: { signal?: AbortSignal } = {},
): Promise<ActionResponse<R['action']>> {
  return api().request<ActionResponse<R['action']>>('/ai/action', {
    method: 'POST',
    body: request,
    signal: options.signal,
  });
}

export function getTodaySummary(): Promise<AiTodaySummary> {
  return api().get<AiTodaySummary>('/ai/today-summary');
}

export function generateTodaySummary(): Promise<AiTodaySummary> {
  return api().request<AiTodaySummary>('/ai/today-summary', { method: 'POST' });
}

export function saveAiAnswer(body: {
  question: string;
  answer: string;
  folder: string;
}): Promise<{ path: VaultPath }> {
  return api().request<{ path: VaultPath }>('/ai/save-answer', { method: 'POST', body });
}

export function semanticSearch(
  q: string,
  limit = 8,
  signal?: AbortSignal,
): Promise<AiSearchResponse> {
  return api().request<AiSearchResponse>('/ai/search', {
    method: 'POST',
    body: { q, limit },
    signal,
  });
}

/** Parses one SSE block (`event:` + `data:` lines) into a chat event; null for comments/unknown. */
export function parseChatEventBlock(block: string): AiChatEvent | null {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (data.length === 0) return null;
  try {
    const payload = JSON.parse(data.join('\n')) as Record<string, unknown>;
    if (type === 'meta' || type === 'delta' || type === 'done' || type === 'error') {
      return { ...payload, type } as AiChatEvent;
    }
  } catch {
    // A malformed block is skipped; the stream's end decides the outcome.
  }
  return null;
}

/**
 * `POST /ai/chat` as a stream of events. Errors before the stream (validation, AI not ready,
 * budget) throw `ApiError` like every other call; `signal` aborts the request (and the provider
 * call on the server).
 */
export async function* streamAiChat(
  request: AiChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<AiChatEvent> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      ...apiAuthHeaders(),
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) {
    let body: { error?: { code?: string; message?: string; details?: unknown } } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // not JSON: keep the status
    }
    const details =
      body.error?.details && typeof body.error.details === 'object'
        ? (body.error.details as Record<string, unknown>)
        : undefined;
    const error = new ApiError(
      response.status,
      body.error?.code ?? `HTTP_${response.status}`,
      body.error?.message ?? response.statusText,
      details,
    );
    // Same as the shared client: a stale window reloads into the vault that is open now.
    if (isVaultSwitchedError(error)) {
      const next = error.details.vaultId;
      notifyVaultSwitched(typeof next === 'string' ? next : null);
    }
    throw error;
  }
  if (!response.body) return;
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary = buffer.search(/\r?\n\r?\n/);
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');
      const event = parseChatEventBlock(block);
      if (event) yield event;
      boundary = buffer.search(/\r?\n\r?\n/);
    }
  }
  const last = parseChatEventBlock(buffer);
  if (last) yield last;
}
