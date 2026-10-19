import { describe, expect, it } from 'vitest';
import { RecentAppChanges } from '../../src/app-context/recent-app-changes.js';
import { createVaultChangeRouter } from '../../src/app-context/vault-change-router.js';
import type { IndexService } from '../../src/index/index-types.js';
import { createSilentLogger } from '../../src/logging/rotating-file-logger.js';
import { VaultError, type VaultChange } from '../../src/vault/vault-types.js';
import type { ServerEvent } from '../../src/ws/server-events.js';

const R1 = 'a'.repeat(64);
const R2 = 'b'.repeat(64);

/** Records index calls; revisions come from a map the test controls (what is "on disk"). */
function fakeIndex(disk: Map<string, string>) {
  const indexed = new Map<string, string>();
  const calls: string[] = [];
  const index = {
    getNote: (path: string) => (indexed.has(path) ? { revision: indexed.get(path) } : null),
    async updateFile(path: string) {
      calls.push(`update ${path}`);
      const revision = disk.get(path);
      if (revision === undefined) throw new VaultError('NOT_FOUND', 'gone', { path });
      indexed.set(path, revision);
    },
    async removeFile(path: string) {
      calls.push(`remove ${path}`);
      indexed.delete(path);
    },
    async renameFile(from: string, to: string) {
      calls.push(`rename ${from} -> ${to}`);
      indexed.set(to, indexed.get(from) ?? disk.get(to) ?? '');
      indexed.delete(from);
    },
    async reconcile() {
      calls.push('reconcile');
    },
    isRebuilding: () => false,
  };
  return { index: index as unknown as IndexService, calls, indexed };
}

function setup() {
  const disk = new Map<string, string>();
  const fake = fakeIndex(disk);
  const events: ServerEvent[] = [];
  const router = createVaultChangeRouter({
    index: fake.index,
    broadcast: (event) => events.push(event),
    logger: createSilentLogger(),
    reconcileDelayMs: 10,
  });
  return { disk, ...fake, events, router };
}

type WithoutOrigin<T> = T extends unknown ? Omit<T, 'origin'> : never;
const app = (change: WithoutOrigin<VaultChange>) => ({ ...change, origin: 'app' }) as VaultChange;
const ext = (change: WithoutOrigin<VaultChange>) =>
  ({ ...change, origin: 'external' }) as VaultChange;

describe('vault change router', () => {
  it('updates the index before telling clients, in arrival order', async () => {
    const { disk, router, calls, events } = setup();
    disk.set('0 Inbox/Ý tưởng.md', R1);
    router.handle(ext({ kind: 'created', path: '0 Inbox/Ý tưởng.md', revision: R1 }));
    router.handle(
      ext({
        kind: 'renamed',
        path: '1 Projects/Ý tưởng.md',
        oldPath: '0 Inbox/Ý tưởng.md',
        revision: R1,
      }),
    );
    router.handle(ext({ kind: 'deleted', path: '1 Projects/Ý tưởng.md' }));
    router.handle(ext({ kind: 'folder-created', path: 'wiki/mới' }));
    await router.settled();
    expect(calls).toEqual([
      'update 0 Inbox/Ý tưởng.md',
      'rename 0 Inbox/Ý tưởng.md -> 1 Projects/Ý tưởng.md',
      'remove 1 Projects/Ý tưởng.md',
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'note:created',
      'note:renamed',
      'note:deleted',
      'folder:changed',
    ]);
  });

  it('drops the watcher echo of an app write but not a later external edit', async () => {
    const { disk, router, calls, events } = setup();
    disk.set('a.md', R1);
    router.handle(app({ kind: 'written', path: 'a.md', revision: R1 }));
    router.handle(ext({ kind: 'written', path: 'a.md', revision: R1 }));
    await router.settled();
    expect(calls).toEqual(['update a.md']);
    expect(events).toEqual([{ type: 'note:changed', path: 'a.md', revision: R1 }]);

    disk.set('a.md', R2);
    router.handle(ext({ kind: 'written', path: 'a.md', revision: R2 }));
    await router.settled();
    expect(calls).toEqual(['update a.md', 'update a.md']);
    expect(events).toHaveLength(2);
  });

  it('recognises echoes of app renames and trash even when reported as separate events', async () => {
    const { disk, router, events } = setup();
    disk.set('Bài 1.md', R1);
    router.handle(app({ kind: 'created', path: 'Bài 1.md', revision: R1 }));
    router.handle(app({ kind: 'renamed', path: 'x/Bài 1.md', oldPath: 'Bài 1.md', revision: R1 }));
    disk.set('x/Bài 1.md', R1);
    router.handle(ext({ kind: 'deleted', path: 'Bài 1.md' }));
    // On-disk spelling may differ in case from the path the app used.
    router.handle(ext({ kind: 'created', path: 'x/bài 1.md', revision: R1 }));
    router.handle(app({ kind: 'deleted', path: 'x/Bài 1.md' }));
    router.handle(ext({ kind: 'deleted', path: 'x/Bài 1.md' }));
    await router.settled();
    expect(events.map((event) => event.type)).toEqual([
      'note:created',
      'note:renamed',
      'note:deleted',
    ]);
  });

  it('removes a file from the index when it vanished before it could be read', async () => {
    const { router, calls, events } = setup();
    router.handle(ext({ kind: 'created', path: 'temp.md', revision: R1 }));
    await router.settled();
    expect(calls).toEqual(['update temp.md', 'remove temp.md']);
    expect(events).toHaveLength(1);
  });

  it('debounces reconcile requests and tells clients to reload afterwards', async () => {
    const { router, calls, events } = setup();
    router.requestReconcile();
    router.requestReconcile();
    await new Promise((resolve) => setTimeout(resolve, 40));
    await router.settled();
    expect(calls).toEqual(['reconcile']);
    expect(events).toEqual([{ type: 'index:progress', phase: 'done', done: 0, total: 0 }]);
    await router.close();
  });
});

describe('recent app changes', () => {
  it('forgets entries after the time-to-live', () => {
    let now = 0;
    const recent = new RecentAppChanges(1000, () => now);
    recent.record(app({ kind: 'written', path: 'a.md', revision: R1 }));
    expect(recent.isEcho(ext({ kind: 'written', path: 'A.md', revision: R1 }))).toBe(true);
    expect(recent.isEcho(ext({ kind: 'written', path: 'a.md', revision: R2 }))).toBe(false);
    now = 2000;
    expect(recent.isEcho(ext({ kind: 'written', path: 'a.md', revision: R1 }))).toBe(false);
  });

  it('compares NFC and NFD spellings as the same path', () => {
    const recent = new RecentAppChanges();
    recent.record(app({ kind: 'created', path: 'Giải tích.md', revision: R1 }));
    const nfd = 'Giải tích.md'.normalize('NFD');
    expect(recent.isEcho(ext({ kind: 'created', path: nfd, revision: R1 }))).toBe(true);
  });
});
