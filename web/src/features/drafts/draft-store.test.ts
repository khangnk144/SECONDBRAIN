import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDraftDatabase, EARLIER_WINDOW_ID } from './draft-database';
import { indexedDbDrafts, listKeptVersions, type NoteDraft } from './draft-store';

const PATH = '1 Projects/Đồ án Giải tích.md';

function draft(overrides: Partial<NoteDraft> = {}): NoteDraft {
  return {
    vaultId: 'vault-a',
    path: PATH,
    baseRevision: 'r1',
    text: 'mine\n',
    ts: 1,
    windowId: 'window-a',
    ...overrides,
  };
}

describe('draft storage in IndexedDB', () => {
  beforeEach(async () => {
    await closeDraftDatabase();
    vi.stubGlobal('indexedDB', new IDBFactory());
  });
  afterEach(async () => {
    await closeDraftDatabase();
    vi.unstubAllGlobals();
  });

  it('writes, reads and removes one draft per vault, note path and window', async () => {
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
    expect(await indexedDbDrafts.write(draft())).toBe(true);
    expect(await indexedDbDrafts.write(draft({ text: 'newer\n', ts: 2 }))).toBe(true);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toEqual(draft({ text: 'newer\n', ts: 2 }));
    // Another vault with the same note path keeps its own draft.
    expect(await indexedDbDrafts.read('vault-b', PATH)).toBeNull();
    await indexedDbDrafts.remove('vault-a', PATH, 'window-a');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('a window removes only its own draft; reading gives the newest draft of any window', async () => {
    await indexedDbDrafts.write(draft({ windowId: 'window-a', text: 'typed in A\n', ts: 5 }));
    await indexedDbDrafts.write(draft({ windowId: 'window-b', text: 'typed in B\n', ts: 3 }));
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe('typed in A\n');
    await indexedDbDrafts.remove('vault-a', PATH, 'window-b');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toMatchObject({
      windowId: 'window-a',
      text: 'typed in A\n',
    });
  });

  it('finds a draft whatever case or Unicode form the path is written in', async () => {
    await indexedDbDrafts.write(draft());
    const nfdLower = PATH.normalize('NFD').toLowerCase();
    expect((await indexedDbDrafts.read('vault-a', nfdLower))?.text).toBe('mine\n');
  });

  it("moves a window's draft with its note on rename", async () => {
    await indexedDbDrafts.write(draft());
    await indexedDbDrafts.write(draft({ windowId: 'window-b', ts: 0 }));
    await indexedDbDrafts.move('vault-a', PATH, '1 Projects/Đồ án mới.md', 'window-a');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toMatchObject({ windowId: 'window-b' });
    expect(await indexedDbDrafts.read('vault-a', '1 Projects/Đồ án mới.md')).toMatchObject({
      path: '1 Projects/Đồ án mới.md',
      windowId: 'window-a',
      text: 'mine\n',
    });
  });

  it('carries drafts of the first database version over, nothing dropped', async () => {
    await closeDraftDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('second-brain-drafts', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('drafts', { keyPath: ['vaultId', 'key'] });
        request.result
          .createObjectStore('kept', { keyPath: 'id', autoIncrement: true })
          .createIndex('by-note', ['vaultId', 'key']);
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('drafts', 'readwrite');
        const { windowId: _w, ...old } = draft({ text: 'from version 1\n' });
        tx.objectStore('drafts').put({ ...old, key: PATH.toLowerCase() });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      request.onerror = () => reject(request.error);
    });
    expect(await indexedDbDrafts.read('vault-a', PATH)).toMatchObject({
      text: 'from version 1\n',
      windowId: EARLIER_WINDOW_ID,
    });
  });

  it('keeps set-aside versions, lists them oldest first and removes one by id', async () => {
    await indexedDbDrafts.write(draft());
    const version = {
      vaultId: 'vault-a',
      path: PATH,
      baseRevision: 'r1',
      text: 'kept\n',
      reason: 'conflict-reload' as const,
      ts: 5,
    };
    expect(await indexedDbDrafts.keep(version)).toBe(true);
    expect(await indexedDbDrafts.keep({ ...version, text: 'kept again\n', ts: 6 })).toBe(true);
    const kept = await indexedDbDrafts.listKept('vault-a', PATH);
    expect(kept.map((v) => v.text)).toEqual(['kept\n', 'kept again\n']);
    expect(await indexedDbDrafts.removeKept(kept[0]?.id ?? -1)).toBe(true);
    expect((await listKeptVersions('vault-a', PATH)).map((v) => v.text)).toEqual(['kept again\n']);
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe('mine\n');
  });

  it('never throws when IndexedDB is missing', async () => {
    await closeDraftDatabase();
    vi.stubGlobal('indexedDB', undefined);
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await indexedDbDrafts.write(draft())).toBe(false);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
    await expect(indexedDbDrafts.remove('vault-a', PATH, 'window-a')).resolves.toBeUndefined();
    expect(await indexedDbDrafts.listKept('vault-a', PATH)).toEqual([]);
    quiet.mockRestore();
  });
});
