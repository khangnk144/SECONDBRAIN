import { createHash } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, waitUntil, type VaultTestApp } from '../api/vault-test-app.js';

const PORT = 4793;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface WsEvent {
  type: string;
  path?: string;
  oldPath?: string;
  revision?: string;
}

describe('outside edits reach the index, the API and WebSocket clients within 1 s (F1.3)', () => {
  let t: VaultTestApp;
  let socket: WebSocket;
  const events: WsEvent[] = [];

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { listen: true, watcher: { stabilityMs: 100 } });
    socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    socket.on('message', (data) => events.push(JSON.parse(String(data)) as WsEvent));
    await new Promise((resolve) => socket.once('open', resolve));
  });
  afterAll(async () => {
    socket.close();
    await t.close();
  });

  const disk = (vaultPath: string) => path.join(t.vaultRoot, ...vaultPath.split('/'));
  const event = (type: string, vaultPath: string) => () =>
    events.find((e) => e.type === type && e.path === vaultPath);
  const search = async (text: string) =>
    (await t.call('GET', `/api/search?q=${encodeURIComponent(text)}`))
      .json()
      .results.map((r: { path: string }) => r.path);

  it('a file written as Notepad would is searchable, readable and announced', async () => {
    const content = '# Ghi chú từ Notepad\n\nTừ khoá quasarword ở đây.\r\n';
    const started = Date.now();
    writeFileSync(disk('0 Inbox/Ghi chú Notepad.md'), content);
    await waitUntil(event('note:created', '0 Inbox/Ghi chú Notepad.md'));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await search('quasarword')).toEqual(['0 Inbox/Ghi chú Notepad.md']);
    const note = (await t.call('GET', `/api/note?${q('0 Inbox/Ghi chú Notepad.md')}`)).json();
    expect(note.revision).toBe(sha(content));
    expect((await t.call('GET', '/api/tree')).json().inboxCount).toBe(1);
  });

  it('an edit updates search and the revision; the event carries the new revision', async () => {
    const content = '# Ghi chú từ Notepad\n\nBây giờ là nebulaword.\n';
    const started = Date.now();
    writeFileSync(disk('0 Inbox/Ghi chú Notepad.md'), content);
    const changed = await waitUntil(event('note:changed', '0 Inbox/Ghi chú Notepad.md'));
    expect(Date.now() - started).toBeLessThan(1000);
    expect(changed.revision).toBe(sha(content));
    expect(await search('nebulaword')).toEqual(['0 Inbox/Ghi chú Notepad.md']);
    expect(await search('quasarword')).toEqual([]);
  });

  it('a rename in Explorer arrives as note:renamed and the tree follows', async () => {
    renameSync(disk('0 Inbox/Ghi chú Notepad.md'), disk('1 Projects/Ghi chú đã chuyển.md'));
    const renamed = await waitUntil(event('note:renamed', '1 Projects/Ghi chú đã chuyển.md'));
    expect(renamed.oldPath).toBe('0 Inbox/Ghi chú Notepad.md');
    const tree = (await t.call('GET', '/api/tree')).json();
    expect(tree.inboxCount).toBe(0);
    const projects = tree.root.folders.find((f: { name: string }) => f.name === '1 Projects');
    expect(projects.files.map((f: { title: string }) => f.title)).toEqual(['Ghi chú đã chuyển']);
    expect(await search('nebulaword')).toEqual(['1 Projects/Ghi chú đã chuyển.md']);
    expect(events.some((e) => e.type === 'note:deleted')).toBe(false);
  });

  it('a deletion removes the note from search and announces it', async () => {
    rmSync(disk('1 Projects/Ghi chú đã chuyển.md'));
    await waitUntil(event('note:deleted', '1 Projects/Ghi chú đã chuyển.md'));
    expect(await search('nebulaword')).toEqual([]);
  });

  it('a save through the API is announced once, not again when the watcher sees it', async () => {
    const created = (await t.call('POST', '/api/note', { path: '2 Areas/Một lần.md' })).json();
    const saved = await t.call('PUT', '/api/note', {
      path: '2 Areas/Một lần.md',
      content: 'chỉ một sự kiện\n',
      expectedRevision: created.revision,
    });
    expect(saved.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 700));
    const forNote = events.filter((e) => e.path === '2 Areas/Một lần.md').map((e) => e.type);
    expect(forNote).toEqual(['note:created', 'note:changed']);
  });
});
