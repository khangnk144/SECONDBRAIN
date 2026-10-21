import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useConnectionStore } from '../../lib/ws/connection-store';
import { ConnectionBanner, CONNECTION_BANNER_DELAY_MS } from './connection-banner';

describe('backend connection banner', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('appears only after the socket has been closed for 2 s and leaves on reconnect', () => {
    render(<ConnectionBanner />);
    act(() => useConnectionStore.getState().setState('open'));
    act(() => useConnectionStore.getState().setState('closed'));
    act(() => vi.advanceTimersByTime(CONNECTION_BANNER_DELAY_MS - 1));
    expect(screen.queryByRole('status')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent(
      'Chưa kết nối với máy chủ. Bấm đúp Mở Second Brain để khởi động.',
    );
    expect(banner.querySelector('strong')).toHaveTextContent('Mở Second Brain');
    act(() => useConnectionStore.getState().setState('open'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('the inline variant (inside Today) carries the same text with its own class', () => {
    useConnectionStore.setState({ state: 'closed', closedSince: Date.now() - 5_000 });
    render(<ConnectionBanner variant="inline" />);
    expect(screen.getByRole('status')).toHaveClass('connection-banner--inline');
    expect(screen.getByRole('status')).toHaveTextContent('Chưa kết nối với máy chủ.');
  });

  it('does not flash for a short drop', () => {
    render(<ConnectionBanner />);
    act(() => useConnectionStore.getState().setState('closed'));
    act(() => vi.advanceTimersByTime(1_000));
    act(() => useConnectionStore.getState().setState('open'));
    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
