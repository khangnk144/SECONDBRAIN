import { readdirSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, snapshotTree, type VaultTestApp } from './vault-test-app.js';

const PORT = 4825;
const COURSE = '2 Areas/Giải tích 1.md';
const LINKERS = ['1 Projects/Đồ án Giải tích.md', 'Daily/2026-10-18.md'];

describe('dry runs of rename and move list the affected notes and change nothing (F4)', () => {
  let t: VaultTestApp;
  let revision: string;
  const journalFiles = () =>
    readdirSync(path.join(t.vaultRoot, '.secondbrain', 'state', 'journal'));

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { watcher: false });
    revision = (await t.call('POST', '/api/note', { path: COURSE, content: '# GT1\n' })).json()
      .revision;
    for (const linker of LINKERS) {
      await t.call('POST', '/api/note', { path: linker, content: 'Môn [[Giải tích 1]]\n' });
    }
    await t.call('POST', '/api/note', { path: '0 Inbox/Giải tích 2.md', content: 'khác\n' });
  });
  afterAll(async () => t?.close());

  it('rename: same planner answer as the real rename, without disk, journal or index changes', async () => {
    // The index database is compared through what it answers (backlinks), not its files.
    const skipCache = (relative: string) => relative.startsWith('.secondbrain/cache');
    const before = snapshotTree(t.vaultRoot, skipCache);
    const journal = journalFiles();
    const backlinks = (await t.call('GET', `/api/note?${q(COURSE)}`)).json().backlinks;
    const res = await t.call('POST', '/api/note/rename', {
      path: COURSE,
      newPath: '2 Areas/Giải tích A1.md',
      expectedRevision: revision,
      dryRun: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      dryRun: true,
      path: '2 Areas/Giải tích A1.md',
      affected: LINKERS,
    });
    expect(snapshotTree(t.vaultRoot, skipCache)).toEqual(before);
    expect(journalFiles()).toEqual(journal);
    expect((await t.call('GET', `/api/note?${q(COURSE)}`)).json().backlinks).toEqual(backlinks);
  });

  it('move: lists the notes and the target path', async () => {
    const res = await t.call('POST', '/api/note/move', {
      path: COURSE,
      folder: '4 Archive',
      expectedRevision: revision,
      dryRun: true,
    });
    expect(res.json()).toEqual({ dryRun: true, path: '4 Archive/Giải tích 1.md', affected: [] });
  });

  it('applies the same checks: 409 CONFLICT for a stale revision, 409 EXISTS for a taken name', async () => {
    const stale = await t.call('POST', '/api/note/rename', {
      path: COURSE,
      newPath: '2 Areas/X.md',
      expectedRevision: 'c'.repeat(64),
      dryRun: true,
    });
    expect([stale.statusCode, stale.json().error.code]).toEqual([409, 'CONFLICT']);
    const taken = await t.call('POST', '/api/note/rename', {
      path: COURSE,
      newPath: '0 Inbox/Giải tích 2.md',
      expectedRevision: revision,
      dryRun: true,
    });
    expect([taken.statusCode, taken.json().error.code]).toEqual([409, 'EXISTS']);
  });
});
