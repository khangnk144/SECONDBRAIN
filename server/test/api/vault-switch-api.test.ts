import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { VaultPlugin } from '../../src/app-context/vault-plugins.js';
import { createVaultHandoverLogger } from '../../src/logging/vault-handover-logger.js';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, waitUntil, type VaultTestApp } from './vault-test-app.js';

const PORT = 47612;
const NOTE = '1 Projects/Đồ án.md';
const note = (marker: string) =>
  `---\ntype: project\n---\n# Đồ án ${marker}\n\n- [ ] Việc ${marker} 📅 2030-01-15\n\nTừ khóa ${marker}.\n`;

/** A per-vault plugin that records when it starts and closes, and for which vault. */
function recordingPlugin(
  events: string[],
): VaultPlugin<{ vaultId: string; close(): Promise<void> }> {
  return {
    name: 'recorder',
    async start(host) {
      const vaultId = host.context.vault.id;
      events.push(`start ${vaultId}`);
      return {
        vaultId,
        async close() {
          events.push(`close ${vaultId}`);
        },
      };
    },
  };
}

describe('vault switch A → B → A (F18.3)', () => {
  let t: VaultTestApp;
  let vaultB: string;
  let idA: string;
  let idB: string;
  const events: string[] = [];
  let releaseSlow: () => void = () => {};
  const settingsFile = () =>
    JSON.parse(readFileSync(path.join(t.home, '.secondbrain', 'settings.json'), 'utf8'));
  const switchTo = (target: string | null) => t.call('POST', '/api/vault/switch', { path: target });
  const read = async () => (await t.call('GET', `/api/note?${q(NOTE)}`)).json().content as string;

  beforeAll(async () => {
    vaultB = makeTempDir('sb vault B Đồ án');
    mkdirSync(path.join(vaultB, '1 Projects'));
    writeFileSync(path.join(vaultB, NOTE), note('Bê'));
    const home = makeTempDir('sb switch home Ghi chú');
    t = await createVaultTestApp(PORT, {
      home,
      listen: true,
      persistSettings: true,
      plugins: [recordingPlugin(events)],
      logger: createVaultHandoverLogger({ dir: path.join(home, '.secondbrain', 'logs') }),
      seed: (root) => {
        mkdirSync(path.join(root, '1 Projects'));
        writeFileSync(path.join(root, NOTE), note('Anh'));
      },
      beforeReady: (app: FastifyInstance) => {
        app.get('/api/test/slow', async () => {
          await new Promise<void>((resolve) => {
            releaseSlow = resolve;
          });
          return { slow: true };
        });
      },
    });
    idA = t.context.vault.id;
  });
  afterAll(async () => {
    const home = t?.home;
    await t?.close();
    if (home) removeDir(home);
    removeDir(vaultB);
  });

  it('A → B: every route answers from B; plugins and logs follow; vaultPath is saved', async () => {
    expect(events).toEqual([`start ${idA}`]);
    expect(await read()).toContain('Đồ án Anh');
    const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    const received: { type: string; vaultId?: string }[] = [];
    socket.on('message', (data) => received.push(JSON.parse(String(data))));
    await waitUntil(() => (received.length >= 2 ? true : undefined));

    const res = await switchTo(vaultB);
    expect(res.statusCode, res.body).toBe(200);
    idB = res.json().vaultId;
    expect(idB).not.toBe(idA);
    expect(res.json().path).toBe(t.host.current.vault.root);
    expect(t.context.vault.id).toBe(idB);

    expect(await read()).toContain('Đồ án Bê');
    const search = (await t.call('GET', '/api/search?q=Bê')).json();
    expect(JSON.stringify(search)).toContain('Đồ án.md');
    expect(JSON.stringify((await t.call('GET', '/api/search?q=Anh')).json().results)).toBe('[]');
    expect(JSON.stringify((await t.call('GET', '/api/tasks')).json())).toContain('Việc Bê');
    expect(JSON.stringify((await t.call('GET', '/api/tasks')).json())).not.toContain('Việc Anh');
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
    expect((await t.call('GET', '/api/health')).json().vaultId).toBe(idB);
    expect((await t.call('GET', '/api/tree')).statusCode).toBe(200);
    expect((await t.call('GET', '/api/graph')).statusCode).toBe(200);

    expect(events).toEqual([`start ${idA}`, `close ${idA}`, `start ${idB}`]);
    expect(t.context.plugin<{ vaultId: string; close(): Promise<void> }>('recorder')?.vaultId).toBe(
      idB,
    );
    expect(settingsFile().vaultPath).toBe(path.resolve(vaultB));
    const view = (await t.call('GET', '/api/settings')).json();
    expect(view.vault).toMatchObject({
      id: idB,
      isDefault: false,
      defaultPath: path.join(t.home, 'vault'),
    });
    await waitUntil(() => received.find((e) => e.type === 'vault:switched'));
    expect(received.filter((e) => e.type === 'vault:switched')).toEqual([
      { type: 'vault:switched', vaultId: idB },
    ]);
    socket.close();
    // Logs moved into B's own folder.
    const logB = readFileSync(path.join(t.host.current.vault.paths.logsDir, 'app.log'), 'utf8');
    expect(logB).toContain(`Switched to vault ${idB}.`);
  });

  it('B → A with null (the default vault): reads come from A again and vaultPath is null', async () => {
    const res = await switchTo(null);
    expect(res.json()).toEqual({ vaultId: idA, path: t.vaultRoot });
    expect(await read()).toContain('Đồ án Anh');
    expect(JSON.stringify((await t.call('GET', '/api/tasks')).json())).not.toContain('Việc Bê');
    expect(events.slice(-2)).toEqual([`close ${idB}`, `start ${idA}`]);
    expect(settingsFile().vaultPath).toBeNull();
    expect((await t.call('GET', '/api/settings')).json().vault.isDefault).toBe(true);
  });

  it('the same vault answers at once without reopening', async () => {
    const before = events.length;
    const res = await switchTo(t.vaultRoot);
    expect(res.json()).toEqual({ vaultId: idA, path: t.vaultRoot });
    expect(events.length).toBe(before);
  });

  it.each([
    ['a missing folder', () => path.join(vaultB, 'không có'), 'not-found'],
    ['a file', () => path.join(vaultB, NOTE), 'not-a-directory'],
    ['the app folder', () => path.join(t.home, 'app'), 'overlaps-app'],
    ['the global state folder', () => path.join(t.home, '.secondbrain'), 'overlaps-app'],
    ['a folder around the install', () => path.dirname(t.home), 'overlaps-app'],
  ])('%s is refused with the reason and A keeps answering', async (_label, target, reason) => {
    const before = events.length;
    const res = await switchTo(target());
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VAULT_UNUSABLE', details: { reason } });
    expect(await read()).toContain('Đồ án Anh');
    expect(events.length).toBe(before);
    expect(settingsFile().vaultPath).toBeNull();
  });

  it('a read-only folder is refused as not-writable (where the platform enforces it)', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // root writes anyway
    const locked = path.join(vaultB, 'khóa');
    mkdirSync(locked);
    chmodSync(locked, 0o555);
    try {
      const res = await switchTo(locked);
      expect(res.json().error.details.reason).toBe('not-writable');
    } finally {
      chmodSync(locked, 0o755);
    }
  });

  it('a relative path is a validation error', async () => {
    const res = await switchTo('vault khác');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { field: 'path', reason: 'not-absolute' },
    });
    expect((await t.call('POST', '/api/vault/switch', {})).json().error.details).toEqual({
      field: 'path',
      reason: 'required',
    });
  });

  it('a folder that fails to open reopens A (open-failed), nothing saved', async () => {
    const broken = makeTempDir('sb vault hỏng');
    mkdirSync(path.join(broken, '.secondbrain'));
    writeFileSync(path.join(broken, '.secondbrain', 'vault.json'), '{ not json');
    try {
      const before = events.length;
      const res = await switchTo(broken);
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({
        code: 'VAULT_UNUSABLE',
        details: { reason: 'open-failed' },
      });
      expect(await read()).toContain('Đồ án Anh');
      expect(t.context.vault.id).toBe(idA);
      expect(events.slice(before)).toEqual([`close ${idA}`, `start ${idA}`]);
      expect(settingsFile().vaultPath).toBeNull();
      expect(readFileSync(path.join(broken, '.secondbrain', 'vault.json'), 'utf8')).toBe(
        '{ not json',
      );
    } finally {
      removeDir(broken);
    }
  });

  it('requests during a switch wait and then succeed from B; in-flight ones finish first; a second switch is 409', async () => {
    const slow = t.call('GET', '/api/test/slow');
    await waitUntil(() => (t.host.gate.inFlight === 1 ? true : undefined));
    const switching = switchTo(vaultB);
    await waitUntil(() => (t.host.gate.closed ? true : undefined));

    const waiting = read();
    const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    const greeted: string[] = [];
    socket.on('message', (data) => greeted.push(JSON.parse(String(data)).type));
    const second = await switchTo(null);
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'switch-in-progress' },
    });
    expect((await t.call('GET', '/api/health')).statusCode).toBe(200); // never held

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(events.at(-1)).toBe(`start ${idA}`); // A is still open: the slow request runs
    expect(greeted).toEqual([]); // the WebSocket waits at the gate too
    releaseSlow();
    expect((await slow).json()).toEqual({ slow: true });
    expect((await switching).json().vaultId).toBe(idB);
    expect(await waiting).toContain('Đồ án Bê');
    await waitUntil(() => (greeted.length >= 2 ? true : undefined));
    expect(greeted).toEqual(['hello', 'journal:pending']);
    socket.close();
  });

  it('a request still naming the previous vault is refused (409 vault-switched)', async () => {
    const res = await t.app.inject({
      method: 'PUT',
      url: '/api/note',
      headers: {
        host: `localhost:${PORT}`,
        'x-sb-token': TEST_TOKEN,
        origin: `http://localhost:${PORT}`,
        'x-sb-vault-id': idA,
      },
      payload: { path: NOTE, content: 'x', expectedRevision: '0'.repeat(64) },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details).toEqual({ reason: 'vault-switched', vaultId: idB });
    expect(await read()).toContain('Đồ án Bê');
    const ok = await t.app.inject({
      method: 'GET',
      url: `/api/note?${q(NOTE)}`,
      headers: { host: `localhost:${PORT}`, 'x-sb-token': TEST_TOKEN, 'x-sb-vault-id': idB },
    });
    expect(ok.statusCode).toBe(200);
  });
});
