import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, waitUntil, type VaultTestApp } from './vault-test-app.js';

const PORT = 4797;
const COURSE = '2 Areas/Giải tích 1.md';
const RENAMED = '2 Areas/Giải tích A1.md';
const LINKERS = ['1 Projects/Đồ án Giải tích.md', 'Daily/2026-10-18.md'];

interface WsMessage {
  type: string;
  entries?: { id: string; op: string; appliedSteps: number; totalSteps: number }[];
}

/** Opens a WS client and collects every message it receives. */
async function connect(port: number): Promise<{ messages: WsMessage[]; close: () => void }> {
  const messages: WsMessage[] = [];
  const socket = new WebSocket(`ws://localhost:${port}/ws?token=${TEST_TOKEN}`);
  socket.on('message', (data) => messages.push(JSON.parse(String(data)) as WsMessage));
  await new Promise((resolve) => socket.once('open', resolve));
  return { messages, close: () => socket.close() };
}

describe('a rename with relink interrupted by a crash is finished or undone after restart (F1.7)', () => {
  const homes: string[] = [];
  afterEach(() => homes.splice(0).forEach(removeDir));

  /** First run: three notes, then a rename whose process "dies" after the first journal step. */
  async function crashMidRename(home: string): Promise<Map<string, Buffer>> {
    const first = await createVaultTestApp(PORT, {
      home,
      watcher: false,
      faults: { crashAfterJournalStep: (_id, applied) => applied === 1 },
    });
    await first.call('POST', '/api/note', { path: COURSE });
    for (const linker of LINKERS) {
      const created = (await first.call('POST', '/api/note', { path: linker })).json();
      await first.call('PUT', '/api/note', {
        path: linker,
        content: `Môn [[Giải tích 1]] và [[Giải tích 1|GT1]]\n`,
        expectedRevision: created.revision,
      });
    }
    const disk = (p: string) => readFileSync(path.join(first.vaultRoot, ...p.split('/')));
    const before = new Map([COURSE, ...LINKERS].map((p) => [p, disk(p)] as const));
    const course = (await first.call('GET', `/api/note?${q(COURSE)}`)).json();
    const res = await first.call('POST', '/api/note/rename', {
      path: COURSE,
      newPath: RENAMED,
      expectedRevision: course.revision,
      relink: true,
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Internal server error.' } });
    await first.close();
    return before;
  }

  async function restartAndListPending(home: string) {
    const second = await createVaultTestApp(PORT, { home, watcher: false, listen: true });
    const { entries } = (await second.call('GET', '/api/journal/pending')).json();
    expect(entries).toEqual([
      expect.objectContaining({ op: 'rename', appliedSteps: 1, totalSteps: 3 }),
    ]);
    const client = await connect(PORT);
    await waitUntil(() => (client.messages.length >= 2 ? true : undefined));
    expect(client.messages[0]!.type).toBe('hello');
    expect(client.messages[1]).toEqual({ type: 'journal:pending', entries });
    return { second, client, id: entries[0].id as string };
  }

  const finishAndCheckBroadcast = async (
    t: VaultTestApp,
    client: Awaited<ReturnType<typeof connect>>,
    url: string,
  ) => {
    const res = await t.call('POST', url);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await waitUntil(() =>
      client.messages.find((m) => m.type === 'journal:pending' && m.entries?.length === 0),
    );
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
  };

  it('"Hoàn tất": complete applies the remaining steps', async () => {
    const home = makeTempDir('sb journal Hoàn tất');
    homes.push(home);
    await crashMidRename(home);
    const { second, client, id } = await restartAndListPending(home);
    try {
      await finishAndCheckBroadcast(second, client, `/api/journal/${id}/complete`);
      expect((await second.call('GET', `/api/note?${q(COURSE)}`)).statusCode).toBe(404);
      const renamed = (await second.call('GET', `/api/note?${q(RENAMED)}`)).json();
      expect(renamed.backlinks.map((b: { fromPath: string }) => b.fromPath).sort()).toEqual(
        [...LINKERS].sort(),
      );
      for (const linker of LINKERS) {
        expect((await second.call('GET', `/api/note?${q(linker)}`)).json().content).toBe(
          'Môn [[Giải tích A1]] và [[Giải tích A1|GT1]]\n',
        );
      }
    } finally {
      client.close();
      await second.close();
    }
  });

  it('"Hoàn tác": undo restores every file byte for byte', async () => {
    const home = makeTempDir('sb journal Hoàn tác');
    homes.push(home);
    const before = await crashMidRename(home);
    const { second, client, id } = await restartAndListPending(home);
    try {
      await finishAndCheckBroadcast(second, client, `/api/journal/${id}/undo`);
      for (const [vaultPath, bytes] of before) {
        expect(readFileSync(path.join(second.vaultRoot, ...vaultPath.split('/')))).toEqual(bytes);
      }
      expect((await second.call('GET', `/api/note?${q(RENAMED)}`)).statusCode).toBe(404);
      const course = (await second.call('GET', `/api/note?${q(COURSE)}`)).json();
      expect(course.backlinks).toHaveLength(2);
    } finally {
      client.close();
      await second.close();
    }
  });
});
