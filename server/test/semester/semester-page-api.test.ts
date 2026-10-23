import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { connectTestClient } from '../mcp/mcp-test-kit.js';
import {
  PAGE,
  SEMESTER_FIXTURE,
  seedFiles,
  startSemesterHost,
  type SemesterHost,
} from './semester-test-host.js';

let h: SemesterHost | null = null;
let plain: VaultTestApp | null = null;
afterEach(async () => {
  await h?.t.close();
  await plain?.close();
  h = null;
  plain = null;
});

const clock = () => makeClock(new Date(2026, 2, 2, 9, 0));

async function withPage(port: number) {
  h = await startSemesterHost(port, {
    now: clock().now,
    seed: (root) => seedFiles(root, SEMESTER_FIXTURE),
  });
  const res = await h.t.call('POST', '/api/semester-page', { action: 'enable' });
  expect(res.statusCode).toBe(200);
  const read = await h.t.context.vault.read(PAGE);
  return { h, revision: read.revision, content: read.content };
}

describe('GET/POST /api/semester-page (F25.1, F25.3)', () => {
  it('answers the state without changing anything; actions answer the new state', async () => {
    h = await startSemesterHost(47821, { now: clock().now });
    const res = await h.t.call('GET', '/api/semester-page');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.json()).toEqual({
      available: true,
      enabled: false,
      path: PAGE,
      state: 'off',
      exists: false,
      edited: false,
      ours: false,
      lastGeneratedAt: null,
    });
    expect(existsSync(h.stateFile())).toBe(false);

    const on = await h.t.call('POST', '/api/semester-page', { action: 'enable' });
    expect(on.json().status).toMatchObject({ enabled: true, state: 'ok', exists: true });
    // The index (tree, search) already has the page when the answer arrives.
    expect(h.t.context.index.getNote(PAGE)).not.toBeNull();
    const bad = await h.t.call('POST', '/api/semester-page', { action: 'delete-everything' });
    expect(bad.statusCode).toBe(400);
    const off = await h.t.call('POST', '/api/semester-page', { action: 'disable' });
    expect(off.json().status).toMatchObject({ enabled: false, state: 'off', exists: true });
    const regenerateOff = await h.t.call('POST', '/api/semester-page', { action: 'regenerate' });
    expect(regenerateOff.statusCode).toBe(400);
    expect(regenerateOff.json().error.details).toEqual({ reason: 'off' });
  });

  it('without the plugin: unavailable and off; actions answer 503', async () => {
    plain = await createVaultTestApp(47822, { watcher: false });
    expect((await plain.call('GET', '/api/semester-page')).json()).toMatchObject({
      available: false,
      enabled: false,
      path: PAGE,
    });
    const res = await plain.call('POST', '/api/semester-page', { action: 'enable' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('UNAVAILABLE');
  });
});

describe('writes to the generated page are refused (F25.2)', () => {
  it('(F25.2) PUT /note, property, task, reschedule, mention, rename, move and restore answer GENERATED_PAGE', async () => {
    const { h, revision, content } = await withPage(47823);
    const nfdUpper = 'HỌC KỲ NÀY.md'.normalize('NFD');
    const attempts: [string, string, unknown][] = [
      ['PUT', '/api/note', { path: PAGE, content: 'x\n', expectedRevision: revision }],
      ['PUT', '/api/note', { path: nfdUpper, content: 'x\n', expectedRevision: revision }],
      [
        'PUT',
        '/api/note',
        { path: PAGE, content: 'x\n', expectedRevision: revision, conflictCopy: true },
      ],
      ['PATCH', '/api/note/frontmatter', { path: PAGE, expectedRevision: revision, set: { a: 1 } }],
      [
        'PATCH',
        '/api/note/task',
        { path: PAGE, expectedRevision: revision, line: 9, expectedText: 'x', done: true },
      ],
      [
        'POST',
        '/api/note/reschedule',
        { path: PAGE, expectedRevision: revision, target: { kind: 'note' }, date: '2026-03-09' },
      ],
      [
        'POST',
        '/api/note/link-mention',
        {
          path: PAGE,
          expectedRevision: revision,
          start: 0,
          end: 3,
          target: '1 Projects/Web bán hàng.md',
        },
      ],
      ['POST', '/api/note/rename', { path: PAGE, newPath: 'Khác.md', expectedRevision: revision }],
      [
        'POST',
        '/api/note/rename',
        { path: PAGE, newPath: 'Khác.md', expectedRevision: revision, dryRun: true },
      ],
      ['POST', '/api/note/move', { path: PAGE, folder: '0 Inbox', expectedRevision: revision }],
      [
        'POST',
        '/api/history/restore',
        { path: PAGE, commit: 'a'.repeat(40), expectedRevision: revision },
      ],
    ];
    for (const [method, url, body] of attempts) {
      const res = await h.t.call(method as 'PUT', url, body);
      expect(res.statusCode, `${method} ${url}`).toBe(409);
      expect(res.json().error, `${method} ${url}`).toMatchObject({
        code: 'GENERATED_PAGE',
        details: { reason: 'generated-page' },
      });
    }
    expect(readFileSync(path.join(h.t.vaultRoot, PAGE), 'utf8')).toBe(content);
    expect(existsSync(path.join(h.t.vaultRoot, 'Khác.md'))).toBe(false);
  });

  it('(F25.2) MCP write_note is refused with GENERATED_PAGE even when note edits are allowed', async () => {
    const { h, revision, content } = await withPage(47824);
    h.t.settings.mcp = { allowNoteEdits: true };
    const mcp = await connectTestClient(h.t);
    try {
      const result = await mcp.call('write_note', {
        path: PAGE,
        content: '# AI\n',
        expectedRevision: revision,
      });
      expect(result.isError).toBe(true);
      expect(result.data).toMatchObject({ code: 'GENERATED_PAGE' });
      // Other notes stay writable.
      const other = await mcp.call('read_note', { path: '1 Projects/Web bán hàng.md' });
      const ok = await mcp.call('write_note', {
        path: '1 Projects/Web bán hàng.md',
        content: '# Web\n',
        expectedRevision: other.data.revision,
      });
      expect(ok.isError).toBe(false);
    } finally {
      await mcp.close();
    }
    expect(readFileSync(path.join(h.t.vaultRoot, PAGE), 'utf8')).toBe(content);
  });

  it('(F25.2) the page is an ordinary note again once it is turned off', async () => {
    const { h, revision } = await withPage(47825);
    await h.t.call('POST', '/api/semester-page', { action: 'disable' });
    const res = await h.t.call('PUT', '/api/note', {
      path: PAGE,
      content: '# Của tôi\n',
      expectedRevision: revision,
    });
    expect(res.statusCode).toBe(200);
  });

  it('(F25.3) the page may still go to the trash from the tree; it is then not brought back', async () => {
    const { h, revision } = await withPage(47826);
    const res = await h.t.call('POST', '/api/note/trash', {
      paths: [PAGE],
      expectedRevisions: [revision],
    });
    expect(res.statusCode).toBe(200);
    await h.rebuild();
    expect(h.page()).toBeNull();
    expect((await h.t.call('GET', '/api/semester-page')).json()).toMatchObject({
      enabled: true,
      state: 'missing',
    });
  });
});
