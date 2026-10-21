import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HISTORY_PLUGIN } from '../../src/app-context/vault-plugins.js';
import { createHistoryPlugin, type HistoryPluginOptions } from '../../src/git/history-plugin.js';
import type { HistoryService } from '../../src/git/history-types.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';
import { commitSubjects, HAS_GIT, isolatedGitEnv, manualTimers } from './git-test-env.js';

const PORT = 47634;
const NOTE = '1 Projects/Đồ án Giải tích.md';
const ORIGINAL = '# Đồ án\n\nBản gốc với [[Giải tích 1]] #ôn-tập\n';

let t: VaultTestApp | null = null;
let git: ReturnType<typeof isolatedGitEnv> | null = null;
afterEach(async () => {
  await t?.close();
  git?.dispose();
  t = null;
  git = null;
});

async function appWithHistory(options: HistoryPluginOptions | null) {
  git = isolatedGitEnv();
  t = await createVaultTestApp(PORT, {
    seed: (root) => {
      mkdirSync(path.join(root, '1 Projects'));
      writeFileSync(path.join(root, NOTE), ORIGINAL);
    },
  });
  if (options === null) return { t, history: null, timers: null };
  const timers = manualTimers();
  const plugin = createHistoryPlugin({ env: git.env, timers, ...options });
  const settings = t.settings;
  const history: HistoryService = await plugin.start({
    context: t.context,
    settings: () => settings,
    port: PORT,
    logger: t.context.logger,
  });
  t.context.attachPlugin(HISTORY_PLUGIN, history);
  await history.idle();
  return { t, history, timers };
}

describe.skipIf(!HAS_GIT)('history routes with git (F20.3)', () => {
  it('an edit, 10 minutes later an auto commit; restoring writes the old text and re-indexes', async () => {
    const { t, history, timers } = await appWithHistory({});
    const status = (await t.call('GET', '/api/history/status')).json();
    expect(status).toMatchObject({ available: true });
    expect(typeof status.lastCommitAt).toBe('string');

    const read = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    // Same link, so only the note changes (a changed link would also touch the event log).
    const edited = '# Đồ án\n\nBản mới với [[Giải tích 1]].\n';
    const saved = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: edited,
      expectedRevision: read.revision,
    });
    expect(saved.statusCode).toBe(200);
    timers!.tick();
    await history!.idle();
    expect(commitSubjects(t.vaultRoot, git!.env)[0]).toBe('auto: 1 files');

    const list = (await t.call('GET', `/api/history?${q(NOTE)}`)).json();
    expect(list.available).toBe(true);
    expect(list.commits.map((c: { message: string }) => c.message)).toEqual([
      'auto: 1 files',
      expect.stringMatching(/^auto: \d+ files$/),
    ]);
    const original = list.commits[1];
    expect(original).toMatchObject({ auto: true, pathAtCommit: NOTE });

    const version = await t.call(
      'GET',
      `/api/history/version?${q(NOTE)}&commit=${original.shortCommit}`,
    );
    expect(version.json()).toEqual({ content: ORIGINAL, pathAtCommit: NOTE });

    const restored = await t.call('POST', '/api/history/restore', {
      path: NOTE,
      commit: original.commit,
      expectedRevision: saved.json().revision,
    });
    expect(restored.statusCode, restored.body).toBe(200);
    const after = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    expect(after.content).toBe(ORIGINAL);
    expect(after.revision).toBe(restored.json().revision);
    // Re-indexed: the restored tag is back in the index.
    expect(after.tags).toEqual(['ôn-tập']);
    expect(commitSubjects(t.vaultRoot, git!.env)[0]).toBe(
      `restore: ${NOTE} @ ${original.shortCommit}`,
    );
    expect(restored.json().commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('restore: 409 with the current revision on a stale one, 404 for a note deleted since', async () => {
    const { t } = await appWithHistory({});
    const [first] = (await t.call('GET', `/api/history?${q(NOTE)}`)).json().commits;
    const stale = await t.call('POST', '/api/history/restore', {
      path: NOTE,
      commit: first.commit,
      expectedRevision: '0'.repeat(64),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({ code: 'CONFLICT', details: { path: NOTE } });
    expect(stale.json().error.details.currentRevision).toMatch(/^[0-9a-f]{64}$/);
    const { revision } = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    await t.call('POST', '/api/note/trash', { paths: [NOTE], expectedRevisions: [revision] });
    const gone = await t.call('POST', '/api/history/restore', {
      path: NOTE,
      commit: first.commit,
      expectedRevision: revision,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('version: 404 where the note did not exist, 400 for bad commits and paths', async () => {
    const { t } = await appWithHistory({});
    const [first] = (await t.call('GET', `/api/history?${q(NOTE)}`)).json().commits;
    const missing = await t.call(
      'GET',
      `/api/history/version?${q('0 Inbox/Chưa có.md')}&commit=${first.commit}`,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe('NOT_FOUND');
    for (const commit of ['HEAD', 'abc', 'g'.repeat(40), `${first.commit}0`, 'ABCDEF1']) {
      const res = await t.call('GET', `/api/history/version?${q(NOTE)}&commit=${commit}`);
      expect(res.statusCode, commit).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
    const notNote = await t.call('GET', `/api/history?${q('Attachments/a.png')}`);
    expect(notNote.statusCode).toBe(400);
    const outside = await t.call('GET', `/api/history?${q('../.git/config.md')}`);
    expect(outside.json().error.code).toBe('INVALID_PATH');
  });

  it('a renamed note keeps its history', async () => {
    const { t, history } = await appWithHistory({});
    const { revision } = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    const renamed = '2 Areas/Đồ án – bản cuối.md';
    const res = await t.call('POST', '/api/note/rename', {
      path: NOTE,
      newPath: renamed,
      expectedRevision: revision,
      relink: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    await history!.commitNow();
    const list = (await t.call('GET', `/api/history?${q(renamed)}`)).json();
    expect(list.commits.map((c: { pathAtCommit: string }) => c.pathAtCommit)).toEqual([
      renamed,
      NOTE,
    ]);
  });

  it('a repository that breaks while running answers 503 git-failed, saving still works', async () => {
    const { t } = await appWithHistory({});
    rmSync(path.join(t.vaultRoot, '.git', 'HEAD'));
    const res = await t.call('GET', `/api/history?${q(NOTE)}`);
    expect(res.statusCode).toBe(503);
    expect(res.json().error.details.reason).toBe('git-failed');
    const { revision } = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    const saved = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'x\n',
      expectedRevision: revision,
    });
    expect(saved.statusCode).toBe(200);
  });

  it('git missing: status says so, listing is empty, version and restore answer 503', async () => {
    const { t } = await appWithHistory({ gitBinary: path.join('no such dir', 'git-missing') });
    expect((await t.call('GET', '/api/history/status')).json()).toEqual({
      available: false,
      reason: 'git-missing',
      lastCommitAt: null,
    });
    expect((await t.call('GET', `/api/history?${q(NOTE)}`)).json()).toEqual({
      available: false,
      commits: [],
    });
    const version = await t.call('GET', `/api/history/version?${q(NOTE)}&commit=abcdef1`);
    expect(version.statusCode).toBe(503);
    expect(version.json().error).toMatchObject({
      code: 'UNAVAILABLE',
      details: { reason: 'git-missing' },
    });
    const { revision } = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    const saved = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'vẫn lưu được\n',
      expectedRevision: revision,
    });
    expect(saved.statusCode).toBe(200);
  });
});

describe('history routes without a history plugin', () => {
  it('answer not-started without touching anything', async () => {
    const { t } = await appWithHistory(null);
    expect((await t.call('GET', '/api/history/status')).json()).toEqual({
      available: false,
      reason: 'not-started',
      lastCommitAt: null,
    });
    expect((await t.call('GET', `/api/history?${q(NOTE)}`)).json()).toEqual({
      available: false,
      commits: [],
    });
    const restore = await t.call('POST', '/api/history/restore', {
      path: NOTE,
      commit: 'abcdef1',
      expectedRevision: '0'.repeat(64),
    });
    expect(restore.statusCode).toBe(503);
    expect(restore.json().error.details.reason).toBe('not-started');
  });
});
