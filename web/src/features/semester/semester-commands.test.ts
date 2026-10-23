import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../lib/app-navigation';
import { availableCommands } from '../../lib/commands/command-registry';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useVaultStore } from '../../lib/vault-store';
import type { SemesterPageStatus } from './semester-api';
import { resetSemesterPageStore, useSemesterPageStore } from './semester-page-store';

const ON: SemesterPageStatus = {
  available: true,
  enabled: true,
  path: 'Học kỳ này.md',
  state: 'ok',
  exists: true,
  edited: false,
  ours: true,
  lastGeneratedAt: null,
};

let mock: FetchMock;
let navigate: ReturnType<typeof vi.fn<Navigator>>;
const listed = () => availableCommands().some((command) => command.id === 'open-semester-page');

beforeEach(async () => {
  navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
  resetSemesterPageStore();
  mock = installFetchMock();
});
afterEach(() => vi.unstubAllGlobals());

describe('"Mở trang Học kỳ này" in the palette (F25)', () => {
  it('is listed only while the page is on and exists, for the open vault', async () => {
    mock.on('GET /api/semester-page', { body: { ...ON, enabled: false, state: 'off' } });
    // Unknown yet: not listed, and the status is asked for.
    expect(listed()).toBe(false);
    await vi.waitFor(() => expect(mock.callsTo('GET /api/semester-page')).toHaveLength(1));
    await vi.waitFor(() => expect(useSemesterPageStore.getState().status).not.toBeNull());
    expect(listed()).toBe(false);

    useSemesterPageStore.setState({ vaultId: 'vault-a', status: ON, loadedAt: Date.now() });
    expect(listed()).toBe(true);
    useSemesterPageStore.setState({ status: { ...ON, exists: false, state: 'missing' } });
    expect(listed()).toBe(false);
    useSemesterPageStore.setState({ status: ON });
    useVaultStore.setState({ vaultId: 'vault-b' });
    expect(listed()).toBe(false);
  });

  it('opens the page', () => {
    useSemesterPageStore.setState({ vaultId: 'vault-a', status: ON, loadedAt: Date.now() });
    availableCommands()
      .find((command) => command.id === 'open-semester-page')
      ?.run();
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent(ON.path)}`,
      undefined,
    );
  });
});
