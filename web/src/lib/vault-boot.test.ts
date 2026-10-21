import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { retryVaultBoot, startVaultBoot, VAULT_RETRY_MS } from './vault-boot';
import { useVaultStore } from './vault-store';
import { useConnectionStore } from './ws/connection-store';

const HEALTH = { ok: true, app: 'second-brain', version: '1.0.0', vaultId: 'vault-a' };

describe('vault boot: the health check is retried until the vault is known', () => {
  let mock: FetchMock;
  let up: boolean;
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(async () => {
    await resetAppState(null);
    useVaultStore.setState({ vaultId: null, ready: false, failed: false });
    vi.useFakeTimers();
    mock = installFetchMock();
    up = false;
    mock.on('GET /api/health', () => (up ? { body: HEALTH } : apiError(503, 'UNAVAILABLE')));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('first check answered: the vault is known at once, no retries', async () => {
    up = true;
    const onFirstCheck = vi.fn();
    const onRecovered = vi.fn();
    const stop = startVaultBoot({ onFirstCheck, onRecovered });
    await flush();
    expect(onFirstCheck).toHaveBeenCalledWith(true);
    expect(useVaultStore.getState()).toMatchObject({ vaultId: 'vault-a', failed: false });
    useConnectionStore.getState().setState('closed');
    useConnectionStore.getState().setState('open');
    await vi.advanceTimersByTimeAsync(VAULT_RETRY_MS * 3);
    expect(mock.callsTo('GET /api/health')).toHaveLength(1);
    expect(onRecovered).not.toHaveBeenCalled();
    stop();
  });

  it('no answer: waits for the socket, then retries every few seconds while it is open', async () => {
    const onFirstCheck = vi.fn();
    const onRecovered = vi.fn();
    useConnectionStore.getState().setState('closed');
    const stop = startVaultBoot({ onFirstCheck, onRecovered });
    await flush();
    expect(onFirstCheck).toHaveBeenCalledWith(false);
    expect(useVaultStore.getState()).toMatchObject({ vaultId: null, failed: true, ready: true });
    // Socket still closed: nothing is polled.
    await vi.advanceTimersByTimeAsync(VAULT_RETRY_MS * 3);
    expect(mock.callsTo('GET /api/health')).toHaveLength(1);

    // The socket opens, but the health check still fails once (server still starting).
    useConnectionStore.getState().setState('open');
    await flush();
    expect(mock.callsTo('GET /api/health')).toHaveLength(2);
    up = true;
    await vi.advanceTimersByTimeAsync(VAULT_RETRY_MS);
    expect(mock.callsTo('GET /api/health')).toHaveLength(3);
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(onFirstCheck).toHaveBeenCalledTimes(1);
    expect(useVaultStore.getState()).toMatchObject({ vaultId: 'vault-a', failed: false });
    // Known: no more checks.
    await vi.advanceTimersByTimeAsync(VAULT_RETRY_MS * 3);
    expect(mock.callsTo('GET /api/health')).toHaveLength(3);
    stop();
  });

  it('"Thử lại" checks again at once; stopping ends every retry', async () => {
    const onRecovered = vi.fn();
    useConnectionStore.getState().setState('closed');
    const stop = startVaultBoot({ onFirstCheck: vi.fn(), onRecovered });
    await flush();
    retryVaultBoot();
    await flush();
    expect(mock.callsTo('GET /api/health')).toHaveLength(2);
    stop();
    up = true;
    retryVaultBoot();
    useConnectionStore.getState().setState('open');
    await vi.advanceTimersByTimeAsync(VAULT_RETRY_MS * 2);
    expect(mock.callsTo('GET /api/health')).toHaveLength(2);
    expect(onRecovered).not.toHaveBeenCalled();
  });
});
