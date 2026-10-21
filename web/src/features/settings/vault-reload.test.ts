import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hydrateVaultState } from '../../app/start-app-services';
import { api, setApiVaultId } from '../../lib/api';
import { apiError } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useTabsStore } from '../../lib/tabs-store';
import { useVaultStore } from '../../lib/vault-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts } from '../drafts/draft-store';
import { acquireNoteSession, resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  settle,
  testSessionDeps,
  typeInto,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { startSettingsSync } from './settings-sync';
import { DRAFT_SETTLE_MS, openOtherVault, setPageReload } from './vault-reload';

// The same relative path exists in both vaults (SPEC F18.3).
const PATH = '1 Projects/Đồ án Xác suất.md';
const VAULT_A = { path: 'D:\\Kho A', id: 'vault-a', isDefault: false, defaultPath: 'D:\\vault' };

describe('vault switch keeps each vault to itself (F18.3)', () => {
  let server: FakeNoteServer;
  let reload: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, '# Đồ án\n');
    server.mock.on('POST /api/vault/switch', { body: { vaultId: 'vault-b', path: 'D:\\Kho B' } });
    reload = vi.fn<() => void>();
    setPageReload(reload);
  });
  afterEach(async () => {
    resetNoteSessions();
    setPageReload(null);
    setApiVaultId(null);
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  /** Runs timers, requests and IndexedDB work until `promise` settled. */
  async function finish<T>(promise: Promise<T>): Promise<T> {
    let settled = false;
    void promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    for (let round = 0; round < 20 && !settled; round += 1) await settle(DRAFT_SETTLE_MS);
    return promise;
  }

  /** A note open in a tab with unsaved typing, like the note screen leaves it. */
  async function typedNote(text: string) {
    useTabsStore.getState().openNote(PATH);
    const session = acquireNoteSession('vault-a', PATH, testSessionDeps());
    await settle();
    typeInto(session, text, 1);
    return session;
  }

  it('saves unsaved typing into the open vault before asking the server to switch, then reloads', async () => {
    await typedNote('Ôn ');
    await expect(finish(openOtherVault('D:\\Kho B', VAULT_A))).resolves.toBe('reloading');
    const order = server.mock.calls.map((call) => `${call.method} ${call.path}`);
    expect(order.indexOf('PUT /api/note')).toBeGreaterThan(-1);
    expect(order.indexOf('PUT /api/note')).toBeLessThan(order.indexOf('POST /api/vault/switch'));
    expect(server.content).toBe('# Ôn Đồ án\n');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a refused switch keeps the current vault: no reload, the reason comes back', async () => {
    server.mock.on(
      'POST /api/vault/switch',
      apiError(400, 'VAULT_UNUSABLE', { reason: 'not-writable' }),
    );
    const done = openOtherVault('D:\\Chỉ đọc', VAULT_A).catch((error: unknown) => error);
    expect(await finish(done)).toMatchObject({
      code: 'VAULT_UNUSABLE',
      details: { reason: 'not-writable' },
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('opening the folder already open does not reload', async () => {
    server.mock.on('POST /api/vault/switch', { body: { vaultId: 'vault-a', path: 'D:\\Kho A' } });
    await expect(finish(openOtherVault('D:\\Kho A', VAULT_A))).resolves.toBe('already-open');
    expect(reload).not.toHaveBeenCalled();
  });

  it('A → B → A: drafts and tabs stay with their vault', async () => {
    await typedNote('Nháp A ');
    // The save fails, so the draft is the only copy of the typing when the switch happens.
    server.failNextWrite = apiError(500, 'WRITE_FAILED');
    await finish(openOtherVault('D:\\Kho B', VAULT_A));
    expect(reload).toHaveBeenCalledTimes(1);

    // "Reload" into B: the same relative path has no draft and no tab there.
    resetNoteSessions();
    useVaultStore.setState({ vaultId: 'vault-b' });
    hydrateVaultState();
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(await indexedDbDrafts.read('vault-b', PATH)).toBeNull();
    useTabsStore.getState().openNote('0 Inbox/Chỉ ở B.md');

    // And back into A: A's tab and draft are there, B's tab is not.
    useVaultStore.setState({ vaultId: 'vault-a' });
    hydrateVaultState();
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([PATH]);
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe('# Nháp A Đồ án\n');
  });

  it('a switch made in another window keeps the drafts here and reloads', async () => {
    const stop = startSettingsSync();
    await typedNote('Cửa sổ khác ');
    emitServerEvent({ type: 'vault:switched', vaultId: 'vault-b' });
    for (let round = 0; round < 5 && reload.mock.calls.length === 0; round += 1) {
      await settle(DRAFT_SETTLE_MS);
    }
    expect(reload).toHaveBeenCalledTimes(1);
    // Nothing was saved into the vault that is open now.
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe('# Cửa sổ khác Đồ án\n');
    stop();
  });

  it('a request refused as "vault-switched" reloads too (and names the vault it was for)', async () => {
    const stop = startSettingsSync();
    setApiVaultId('vault-a');
    server.mock.on(
      'GET /api/tree',
      apiError(409, 'CONFLICT', { reason: 'vault-switched', vaultId: 'vault-b' }),
    );
    const refused = api()
      .get('/tree')
      .catch((error: unknown) => error);
    expect(await finish(refused)).toMatchObject({ code: 'CONFLICT' });
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });
});
