import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/app';
import { resetAppState } from '../lib/testing/reset-app-state';
import { useVaultStore } from '../lib/vault-store';
import connectionVi from '../i18n/locales/connection.vi.json';

/** A socket that can never connect, like the browser's when no server listens. */
class RefusedSocket {
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    setTimeout(() => {
      this.onerror?.(new Event('error'));
      this.onclose?.(new CloseEvent('close', { code: 1006 }));
    }, 0);
  }
  close() {}
  send() {}
}

const bannerText = connectionVi.offline.replace(/<\/?strong>/g, '');

describe('offline shell boot: no server behind the cached shell (F21.3)', () => {
  const failures: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent) => failures.push(event.reason);
  const onError = (event: ErrorEvent) => failures.push(event.error ?? event.message);
  const onProcessRejection = (reason: unknown) => failures.push(reason);

  beforeEach(async () => {
    await resetAppState(null);
    useVaultStore.setState({ vaultId: null, ready: false });
    failures.length = 0;
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    process.on('unhandledRejection', onProcessRejection);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    vi.stubGlobal('WebSocket', RefusedSocket);
  });
  afterEach(() => {
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('error', onError);
    process.off('unhandledRejection', onProcessRejection);
    vi.unstubAllGlobals();
  });

  it('boots, shows the "not connected" banner and throws nothing when every API call fails', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { unmount } = render(<App />);
    await waitFor(
      () => {
        const banners = screen.queryAllByRole('status').map((el) => el.textContent ?? '');
        expect(banners).toContain(bannerText);
      },
      { timeout: 5_000 },
    );
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalled();
    await vi.waitFor(() => expect(useVaultStore.getState().ready).toBe(true));
    // Let the failed first fetches settle before checking that nothing escaped.
    await new Promise((resolve) => setTimeout(resolve, 50));
    unmount();
    expect(failures).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  }, 10_000);
});
