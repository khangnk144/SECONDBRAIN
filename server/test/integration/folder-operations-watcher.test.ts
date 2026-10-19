import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { HubSocket } from '../../src/ws/websocket-hub.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 4828;
const FOLDER = '2 Areas/Môn học kỳ 1';
const NOTES = [`${FOLDER}/Giải tích 1.md`, `${FOLDER}/Bài tập/Tuần 1.md`];

describe('folder operations with the file watcher running (F2.2, F1.3)', () => {
  let t: VaultTestApp;
  const events: { type: string; path?: string }[] = [];

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: { stabilityMs: 50, renameWindowMs: 200 },
      seed: (root) => {
        for (const note of NOTES) {
          mkdirSync(path.dirname(path.join(root, ...note.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...note.split('/')), `# ${note}\n`);
        }
        writeFileSync(path.join(root, 'Mục lục.md'), `[[${FOLDER}/Giải tích 1]]\n`);
      },
    });
    const socket: HubSocket = {
      readyState: 1,
      bufferedAmount: 0,
      send: (data) => events.push(JSON.parse(data)),
      terminate: () => undefined,
      on: () => undefined,
    };
    t.context.hub.add(socket);
  });
  afterAll(async () => t?.close());

  const settle = () => new Promise((resolve) => setTimeout(resolve, 1500));

  it("the watcher's echo of a folder rename and of its undo adds no events and no re-scan", async () => {
    const res = await t.call('POST', '/api/folder/rename', {
      path: FOLDER,
      newPath: '4 Archive/Kỳ 1',
    });
    expect(res.statusCode, res.body).toBe(200);
    const own = events.length;
    await settle();
    expect(events.slice(own)).toEqual([]);
    expect(
      (await t.call('GET', `/api/note?${q('4 Archive/Kỳ 1/Bài tập/Tuần 1.md')}`)).statusCode,
    ).toBe(200);
    expect((await t.call('GET', `/api/note?${q('Mục lục.md')}`)).json().content).toBe(
      '[[4 Archive/Kỳ 1/Giải tích 1]]\n',
    );
    const undo = await t.call('POST', `/api/journal/${res.json().journalId}/undo`);
    expect(undo.statusCode).toBe(200);
    const afterUndo = events.length;
    await settle();
    expect(events.slice(afterUndo)).toEqual([]);
    expect(events.some((e) => e.type === 'index:progress')).toBe(false);
  });

  it('a folder trash is reported once (no echo), and the index forgets the notes', async () => {
    const before = events.length;
    const res = await t.call('POST', '/api/folder/trash', { path: FOLDER });
    expect(res.statusCode, res.body).toBe(200);
    const own = events.slice(before).map((e) => `${e.type} ${e.path}`);
    expect(own).toEqual(expect.arrayContaining(NOTES.map((n) => `note:deleted ${n}`)));
    const count = events.length;
    await settle();
    expect(events.slice(count)).toEqual([]);
    const search = (await t.call('GET', '/api/search?q=tuan')).json();
    expect(search.results.map((r: { path: string }) => r.path)).not.toContain(NOTES[1]);
  });
});
