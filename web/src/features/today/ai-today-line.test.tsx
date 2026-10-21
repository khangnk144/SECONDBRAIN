import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiStatus } from '../../lib/api/ai-types';
import { useAiStatusStore } from '../../lib/ai-status-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { aiStatus } from '../ai-chat/chat-test-kit';
import { AiTodayLine, resetAiTodayLine } from './ai-today-line';

const LINE = 'Hôm nay bạn có 2 việc, 1 deadline trong 3 ngày.';
let mock: FetchMock;

function setStatus(status: AiStatus | null) {
  useAiStatusStore.setState({ status });
}

describe('Today "Trợ lý" line (F33, F10 stays quiet)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetAiTodayLine();
    mock = installFetchMock();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 8, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows the cached sentence, marked as the AI's, without asking for a new one", async () => {
    setStatus(aiStatus());
    mock.on('GET /api/ai/today-summary', { body: { date: '2026-10-21', text: LINE } });
    render(<AiTodayLine />);
    const line = await screen.findByText(LINE);
    expect(line.closest('p')).toHaveTextContent(`AITrợ lý AI: ${LINE}`);
    expect(mock.callsTo('POST /api/ai/today-summary')).toHaveLength(0);
  });

  it('asks the server to write it once per day per window, even when it stays empty', async () => {
    setStatus(aiStatus());
    mock.on('GET /api/ai/today-summary', { body: { date: '2026-10-21', text: null } });
    mock.on('POST /api/ai/today-summary', { body: { date: '2026-10-21', text: LINE } });
    const first = render(<AiTodayLine />);
    expect(await screen.findByText(LINE)).toBeInTheDocument();
    first.unmount();
    mock.on('POST /api/ai/today-summary', { body: { date: '2026-10-21', text: null } });
    render(<AiTodayLine />);
    // A status refresh (new object, still ready) does not ask again either.
    act(() => setStatus(aiStatus()));
    await vi.waitFor(() => expect(mock.callsTo('GET /api/ai/today-summary')).toHaveLength(2));
    expect(mock.callsTo('POST /api/ai/today-summary')).toHaveLength(1);
  });

  it('a failure shows nothing and is not retried the same day', async () => {
    setStatus(aiStatus());
    mock.on('GET /api/ai/today-summary', { body: { date: '2026-10-21', text: null } });
    mock.on(
      'POST /api/ai/today-summary',
      apiError(502, 'AI_PROVIDER_ERROR', { reason: 'network' }),
    );
    const { container, unmount } = render(<AiTodayLine />);
    await vi.waitFor(() => expect(mock.callsTo('POST /api/ai/today-summary')).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
    unmount();
    render(<AiTodayLine />);
    await vi.waitFor(() => expect(mock.callsTo('GET /api/ai/today-summary')).toHaveLength(2));
    expect(mock.callsTo('POST /api/ai/today-summary')).toHaveLength(1);
  });

  it('nothing at all while AI is not ready or the status is unknown', async () => {
    setStatus(null);
    const { container, rerender } = render(<AiTodayLine />);
    act(() => setStatus(aiStatus({ ready: false, reason: 'no-key', hasKey: false })));
    rerender(<AiTodayLine />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    expect(mock.calls).toHaveLength(0);
  });

  it('a new day brings a new line', async () => {
    setStatus(aiStatus());
    mock.on('GET /api/ai/today-summary', { body: { date: '2026-10-21', text: LINE } });
    render(<AiTodayLine />);
    expect(await screen.findByText(LINE)).toBeInTheDocument();
    mock.on('GET /api/ai/today-summary', { body: { date: '2026-10-22', text: null } });
    mock.on('POST /api/ai/today-summary', { body: { date: '2026-10-22', text: 'Ngày mới.' } });
    vi.setSystemTime(new Date(2026, 9, 22, 7, 0));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    expect(await screen.findByText('Ngày mới.')).toBeInTheDocument();
    expect(screen.queryByText(LINE)).toBeNull();
    expect(mock.callsTo('POST /api/ai/today-summary')).toHaveLength(1);
  });
});
