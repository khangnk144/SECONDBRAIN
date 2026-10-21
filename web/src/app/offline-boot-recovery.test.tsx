import { render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPageReload } from '../features/settings/vault-reload';
import { closeDraftDatabase } from '../features/drafts/draft-database';
import { freshDraftDatabase } from '../features/note-session/session-test-kit';
import noteVi from '../i18n/locales/note.vi.json';
import { setApiVaultId } from '../lib/api';
import type { VaultTree } from '../lib/api/tree-types';
import { installFetchMock, type FetchMock } from '../lib/testing/fetch-mock';
import { resetAppState } from '../lib/testing/reset-app-state';
import { usePanesStore } from '../lib/panes-store';
import { useTabsStore } from '../lib/tabs-store';
import { useVaultStore } from '../lib/vault-store';
import { App } from './app';

const PATH = '0 Inbox/Sách cần mượn.md';

/** The browser's socket, opened or refused by the test (like a server that is down, then up). */
class ControlledSocket {
  static all: ControlledSocket[] = [];
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  constructor() {
    ControlledSocket.all.push(this);
  }
  refuse() {
    this.onerror?.(new Event('error'));
    this.onclose?.(new CloseEvent('close', { code: 1006 }));
  }
  accept() {
    this.onopen?.(new Event('open'));
  }
  close() {}
  send() {}
}

const tree: VaultTree = {
  inboxCount: 1,
  root: {
    path: '',
    name: '',
    noteCount: 1,
    urgent: false,
    files: [],
    folders: [
      {
        path: '0 Inbox',
        name: '0 Inbox',
        noteCount: 1,
        urgent: false,
        folders: [],
        files: [
          {
            path: PATH,
            name: 'Sách cần mượn.md',
            title: 'Sách cần mượn',
            class: 'user',
            isNote: true,
            size: 40,
            mtime: 0,
          },
        ],
      },
    ],
  },
};

describe('app started before the server (installed app at login, F21.2, F21.3)', () => {
  let mock: FetchMock;
  let serverUp: boolean;
  let reload: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    await resetAppState(null);
    await freshDraftDatabase();
    // A fresh page: nothing per vault has been read yet.
    useVaultStore.setState({ vaultId: null, ready: false, failed: false });
    useTabsStore.setState({ hydrated: false });
    usePanesStore.setState({ hydrated: false });
    ControlledSocket.all = [];
    vi.stubGlobal('WebSocket', ControlledSocket);
    reload = vi.fn<() => void>();
    setPageReload(reload);
    mock = installFetchMock();
    mock.on('GET /api/health', {
      body: { ok: true, app: 'second-brain', version: '1.0.0', vaultId: 'vault-a' },
    });
    mock.on('GET /api/tree', { body: tree });
    mock.on('GET /api/note', {
      body: {
        path: PATH,
        content: '# Sách cần mượn\n\nGiáo trình Giải tích 1\n',
        revision: 'r1',
        utf8: true,
        mtime: 0,
        frontmatter: null,
        frontmatterError: null,
        backlinks: [],
        outlinks: [],
        tags: [],
        class: 'user',
      },
    });
    // Every request fails like a refused connection until the server is "started".
    serverUp = false;
    const answer = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (!serverUp) throw new TypeError('Failed to fetch');
        return answer(input, init);
      }),
    );
    window.location.hash = `#/note?path=${encodeURIComponent(PATH)}`;
  });
  afterEach(async () => {
    window.location.hash = '';
    setPageReload(null);
    setApiVaultId(null);
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('learns the vault, loads the tree and opens the note once the server answers, without a reload', async () => {
    const { unmount } = render(<App />);
    await waitFor(() => expect(ControlledSocket.all).toHaveLength(1));
    ControlledSocket.all[0]?.refuse();

    // Down: the note says it could not open (with "Thử lại") instead of "opening…" forever.
    expect(await screen.findByText(noteVi.loadFailed)).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('button', { name: noteVi.retryOpen })).toBeVisible();
    expect(screen.queryByText(noteVi.loading)).toBeNull();
    expect(useVaultStore.getState()).toMatchObject({ vaultId: null, failed: true });

    // Up: the next socket attempt opens (no earlier open, so this is the first connection).
    serverUp = true;
    await waitFor(() => expect(ControlledSocket.all).toHaveLength(2), { timeout: 3_000 });
    ControlledSocket.all[1]?.accept();

    await waitFor(() => expect(useVaultStore.getState().vaultId).toBe('vault-a'));
    const folders = await screen.findByRole('tree');
    expect(await within(folders).findByRole('treeitem', { name: /0 Inbox/ })).toBeVisible();
    expect(await screen.findByText('Giáo trình Giải tích 1')).toBeVisible();
    expect(screen.queryByText(noteVi.loadFailed)).toBeNull();
    expect(screen.queryByText(noteVi.loading)).toBeNull();
    // The vault-switch guard is on: requests after recovery name the vault.
    const noteRead = mock.callsTo('GET /api/note').at(-1);
    expect(noteRead).toBeDefined();
    const sent = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).startsWith('/api/note'));
    const headers = new Headers(sent.at(-1)?.[1]?.headers);
    expect(headers.get('x-sb-vault-id')).toBe('vault-a');
    // The route's note is in the tab strip of that vault.
    expect(useTabsStore.getState().tabs.map((tab) => tab.path)).toEqual([PATH]);
    expect(reload).not.toHaveBeenCalled();
    unmount();
  }, 15_000);
});
