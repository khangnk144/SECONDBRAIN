import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, waitUntil, type VaultTestApp } from './vault-test-app.js';

const PORT = 47618;

/** Leaves vault `<home>/vault` with one unfinished rename in its journal (a "crash"). */
async function vaultWithPendingRename(home: string): Promise<void> {
  const crashing = await createVaultTestApp(PORT + 1, {
    home,
    watcher: false,
    faults: { crashAfterJournalStep: (_id, applied) => applied === 1 },
  });
  await crashing.call('POST', '/api/note', { path: '2 Areas/Giải tích 1.md' });
  const linker = (await crashing.call('POST', '/api/note', { path: '0 Inbox/Bài 1.md' })).json();
  await crashing.call('PUT', '/api/note', {
    path: '0 Inbox/Bài 1.md',
    content: 'Môn [[Giải tích 1]]\n',
    expectedRevision: linker.revision,
  });
  const course = (await crashing.call('GET', `/api/note?${q('2 Areas/Giải tích 1.md')}`)).json();
  await crashing.call('POST', '/api/note/rename', {
    path: '2 Areas/Giải tích 1.md',
    newPath: '2 Areas/Giải tích A.md',
    expectedRevision: course.revision,
    relink: true,
  });
  await crashing.close();
}

function greeting(): Promise<{ type: string; entries?: unknown[] }[]> {
  return new Promise((resolve) => {
    const received: { type: string }[] = [];
    const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    socket.on('message', (data) => {
      received.push(JSON.parse(String(data)));
      if (received.length === 2) {
        socket.close();
        resolve(received);
      }
    });
  });
}

describe('per-vault journal state across a switch (F18.3)', () => {
  let t: VaultTestApp;
  let homeB: string;
  beforeAll(async () => {
    homeB = makeTempDir('sb home B Nhật ký');
    await vaultWithPendingRename(homeB);
    t = await createVaultTestApp(PORT, { listen: true });
  });
  afterAll(async () => {
    await t?.close();
    removeDir(homeB);
  });

  it('pending operations and the WebSocket greeting come from the vault that is open', async () => {
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
    expect((await greeting())[1]).toEqual({ type: 'journal:pending', entries: [] });

    const res = await t.call('POST', '/api/vault/switch', { path: path.join(homeB, 'vault') });
    expect(res.statusCode, res.body).toBe(200);
    const { entries } = (await t.call('GET', '/api/journal/pending')).json();
    expect(entries).toEqual([expect.objectContaining({ op: 'rename', appliedSteps: 1 })]);
    await waitUntil(async () => ((await greeting())[1]?.entries?.length === 1 ? true : undefined));

    await t.call('POST', '/api/vault/switch', { path: null });
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
    expect((await greeting())[1]).toEqual({ type: 'journal:pending', entries: [] });
  });
});
