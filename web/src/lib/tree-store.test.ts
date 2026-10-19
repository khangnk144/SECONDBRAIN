import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { makeTree } from './testing/tree-fixture';
import { startTreeSync, TREE_REFRESH_DEBOUNCE_MS, useTreeStore } from './tree-store';
import { useVaultStore } from './vault-store';
import { emitServerEvent } from './ws/server-event-bus';

const tree = () => useTreeStore.getState();

describe('tree store', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
    mock.on('GET /api/tree', { body: makeTree({ folders: ['0 Inbox'], notes: ['0 Inbox/a.md'] }) });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('remembers expanded folders per vault (F2.1)', () => {
    tree().hydrate();
    expect(tree().expanded).toEqual(['0 Inbox', '1 Projects']);
    tree().setExpanded('2 Areas', true);
    tree().toggleExpanded('0 Inbox');
    expect(JSON.parse(localStorage.getItem('sb:vault-a:tree.expanded') ?? '[]')).toEqual([
      '1 Projects',
      '2 Areas',
    ]);
    useVaultStore.setState({ vaultId: 'vault-b' });
    tree().hydrate();
    expect(tree().expanded).toEqual(['0 Inbox', '1 Projects']);
    tree().setExpanded('1 Projects', false);
    useVaultStore.setState({ vaultId: 'vault-a' });
    tree().hydrate();
    expect(tree().expanded).toEqual(['1 Projects', '2 Areas']);
  });

  it('keeps expanded folders through a folder rename', () => {
    useTreeStore.setState({ expanded: ['2 Areas/Cũ', '2 Areas/Cũ/Sub', 'Daily'] });
    tree().renameExpanded('2 Areas/Cũ', '2 Areas/Mới');
    expect(tree().expanded).toEqual(['2 Areas/Mới', '2 Areas/Mới/Sub', 'Daily']);
  });

  it('refetches once, 150 ms after a burst of file events (F2.3)', async () => {
    vi.useFakeTimers();
    const stop = startTreeSync();
    emitServerEvent({ type: 'note:created', path: '0 Inbox/b.md', revision: 'r' });
    emitServerEvent({ type: 'note:changed', path: '0 Inbox/b.md', revision: 'r' });
    emitServerEvent({ type: 'folder:changed', path: '2 Areas/Mới' });
    emitServerEvent({ type: 'index:progress', phase: 'index', done: 1, total: 2 });
    await vi.advanceTimersByTimeAsync(TREE_REFRESH_DEBOUNCE_MS - 1);
    expect(mock.callsTo('GET /api/tree')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(mock.callsTo('GET /api/tree')).toHaveLength(1);
    expect(tree().tree?.inboxCount).toBe(1);

    emitServerEvent({ type: 'resync' });
    emitServerEvent({ type: 'index:progress', phase: 'done', done: 2, total: 2 });
    await vi.advanceTimersByTimeAsync(TREE_REFRESH_DEBOUNCE_MS);
    expect(mock.callsTo('GET /api/tree')).toHaveLength(2);
    stop();
  });

  it('ignores an older answer that arrives after a newer one', async () => {
    let release: (() => void) | null = null;
    let first = true;
    mock.on('GET /api/tree', async () => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => (release = resolve));
        return { body: makeTree({ folders: ['Old'], notes: [] }) };
      }
      return { body: makeTree({ folders: ['New'], notes: [] }) };
    });
    const slow = tree().fetchTree();
    await tree().fetchTree();
    (release as unknown as () => void)();
    await slow;
    expect(tree().tree?.root.folders.map((f) => f.name)).toEqual(['New']);
  });
});
