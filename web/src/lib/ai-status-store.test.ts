import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aiStatus } from '../features/ai-chat/chat-test-kit';
import {
  AI_STATUS_REFRESH_DEBOUNCE_MS,
  isInAiScope,
  startAiStatusSync,
  useAiStatusStore,
} from './ai-status-store';
import { installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { DEFAULT_UI_PREFS } from './ui-prefs';
import { emitServerEvent } from './ws/server-event-bus';

let mock: FetchMock;
const statusCalls = () => mock.callsTo('GET /api/ai/status').length;

describe('AI status store stays current (F33)', () => {
  let stop: () => void = () => undefined;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    mock.on('GET /api/ai/status', { body: aiStatus() });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('loads at start, then refetches (debounced) on ai:status, settings:changed, resync and visibility', async () => {
    stop = startAiStatusSync();
    await vi.waitFor(() => expect(useAiStatusStore.getState().status?.ready).toBe(true));
    expect(statusCalls()).toBe(1);
    vi.useFakeTimers();
    mock.on('GET /api/ai/status', { body: aiStatus({ ready: false, reason: 'budget' }) });
    emitServerEvent({ type: 'ai:status', embeddings: { state: 'idle', done: 0, total: 0 } });
    emitServerEvent({ type: 'settings:changed', ui: DEFAULT_UI_PREFS });
    emitServerEvent({ type: 'resync' });
    await vi.advanceTimersByTimeAsync(AI_STATUS_REFRESH_DEBOUNCE_MS);
    expect(statusCalls()).toBe(2);
    vi.useRealTimers();
    await vi.waitFor(() => expect(useAiStatusStore.getState().status?.reason).toBe('budget'));
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(AI_STATUS_REFRESH_DEBOUNCE_MS);
    expect(statusCalls()).toBe(3);
  });

  it('keeps the last status when a refetch fails', async () => {
    useAiStatusStore.setState({ status: aiStatus() });
    mock.on('GET /api/ai/status', { status: 500, body: { error: { code: 'INTERNAL' } } });
    await useAiStatusStore.getState().load();
    expect(useAiStatusStore.getState().status?.ready).toBe(true);
  });

  it('scope: top folders compared without case, root notes as ""', () => {
    const status = aiStatus({ scope: ['', '1 Projects', 'wiki'] });
    expect(isInAiScope(status, 'Ghi chú gốc.md')).toBe(true);
    expect(isInAiScope(status, '1 projects/Đồ án.md')).toBe(true);
    expect(isInAiScope(status, '3 Resources/papers/x.pdf')).toBe(false);
    expect(isInAiScope(null, 'wiki/a.md')).toBe(false);
  });
});
