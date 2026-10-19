import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4790;
const REV = '0'.repeat(64);
const NOTE = q('0 Inbox/a.md');

/** Every vault route of this milestone with a plausible request. */
const ROUTES: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string; payload?: unknown }[] = [
  { method: 'GET', url: '/api/tree' },
  { method: 'GET', url: `/api/note?${NOTE}` },
  {
    method: 'PUT',
    url: '/api/note',
    payload: { path: '0 Inbox/a.md', content: 'x', expectedRevision: REV },
  },
  { method: 'POST', url: '/api/note', payload: { path: '0 Inbox/a.md' } },
  {
    method: 'POST',
    url: '/api/note/rename',
    payload: { path: '0 Inbox/a.md', newPath: '0 Inbox/b.md', expectedRevision: REV, relink: true },
  },
  {
    method: 'POST',
    url: '/api/note/move',
    payload: { path: '0 Inbox/a.md', folder: '1 Projects', expectedRevision: REV, relink: true },
  },
  {
    method: 'POST',
    url: '/api/note/trash',
    payload: { paths: ['0 Inbox/a.md'], expectedRevisions: [REV] },
  },
  { method: 'GET', url: '/api/journal/pending' },
  { method: 'POST', url: '/api/journal/01JAAAAAAAAAAAAAAAAAAAAAAA/undo' },
  { method: 'POST', url: '/api/journal/01JAAAAAAAAAAAAAAAAAAAAAAA/complete' },
  { method: 'POST', url: '/api/folder', payload: { path: 'Mới' } },
  { method: 'GET', url: '/api/search?q=giai%20tich' },
  { method: 'GET', url: '/api/today' },
  { method: 'GET', url: '/api/calendar?month=2026-10' },
  { method: 'GET', url: '/api/tasks?includeArchive=true' },
  { method: 'GET', url: '/api/tags' },
  { method: 'GET', url: `/api/files?${q('Templates/Note.md')}` },
  { method: 'GET', url: '/api/templates' },
  { method: 'POST', url: '/api/templates/restore' },
  { method: 'POST', url: '/api/index/rebuild' },
  { method: 'GET', url: '/api/sample-data' },
  { method: 'POST', url: '/api/sample-data' },
  { method: 'DELETE', url: '/api/sample-data' },
];

const label = (route: (typeof ROUTES)[number]) => `${route.method} ${route.url.split('?')[0]}`;

describe('security on every vault route (SPEC §11)', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { listen: true });
  });
  afterAll(async () => t?.close());

  const send = (route: (typeof ROUTES)[number], headers: Record<string, string>) =>
    t.app.inject({
      method: route.method,
      url: route.url,
      headers,
      ...(route.payload === undefined ? {} : { payload: route.payload as object }),
    });

  it.each(ROUTES.map((route) => [label(route), route] as const))(
    '%s: missing or wrong token → 401, wrong Host → 421',
    async (_name, route) => {
      const host = `localhost:${PORT}`;
      const attempts: Record<string, string>[] = [{ host }, { host, 'x-sb-token': 'wrong-token' }];
      for (const headers of attempts) {
        const res = await send(route, headers);
        expect(res.statusCode).toBe(401);
        expect(res.json().error.code).toBe('UNAUTHORIZED');
      }
      const misdirected = await send(route, {
        host: 'evil.example:4790',
        'x-sb-token': TEST_TOKEN,
      });
      expect(misdirected.statusCode).toBe(421);
    },
  );

  it.each(
    ROUTES.filter((route) => route.method !== 'GET').map((route) => [label(route), route] as const),
  )('%s: a foreign Origin is refused with 403 before anything runs', async (_name, route) => {
    const res = await send(route, {
      host: `localhost:${PORT}`,
      'x-sb-token': TEST_TOKEN,
      origin: 'http://evil.example',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
  });

  it('a foreign Origin never created anything', async () => {
    expect((await t.call('GET', '/api/sample-data')).json()).toEqual({
      offered: true,
      present: false,
    });
    expect((await t.call('GET', `/api/note?${NOTE}`)).statusCode).toBe(404);
  });

  it('health needs no token and reports the vault id', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { host: `localhost:${PORT}` },
    });
    expect(res.json()).toMatchObject({ ok: true, vaultId: t.context.vault.id });
    expect(t.context.vault.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('refuses a WebSocket without a token and accepts one with it (hello, then journal state)', async () => {
    const refused = await new Promise<number>((resolve) => {
      const socket = new WebSocket(`ws://localhost:${PORT}/ws`);
      socket.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      socket.on('error', () => resolve(-1));
    });
    expect(refused).toBe(401);
    const messages = await new Promise<string[]>((resolve) => {
      const received: string[] = [];
      const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
      socket.on('message', (data) => {
        received.push(String(data));
        if (received.length === 2) {
          socket.close();
          resolve(received);
        }
      });
    });
    expect(JSON.parse(messages[0]!)).toMatchObject({ type: 'hello' });
    expect(JSON.parse(messages[1]!)).toEqual({ type: 'journal:pending', entries: [] });
  });
});
