import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HISTORY_PLUGIN } from '../../src/app-context/vault-plugins.js';
import { createHistoryPlugin } from '../../src/git/history-plugin.js';
import type { HistoryService } from '../../src/git/history-types.js';
import { createVaultTestApp, q, type VaultTestApp } from '../api/vault-test-app.js';
import { commitSubjects, HAS_GIT, isolatedGitEnv, manualTimers } from './git-test-env.js';

const PORT = 47603;
const NOTE = '1 Projects/Luận văn.md';
const V1 = '# Luận văn\n\nBản đầu.\n';
const V2 = '# Luận văn\n\nBản hai, đã tự lưu vào lịch sử.\n';
const LATEST = '# Luận văn\n\nBản hai, đã tự lưu vào lịch sử.\n\nĐoạn viết sau lần tự lưu cuối.\n';

let t: VaultTestApp | null = null;
let git: ReturnType<typeof isolatedGitEnv> | null = null;
afterEach(async () => {
  await t?.close();
  git?.dispose();
  t = null;
  git = null;
});

/** V1 and V2 are in history; LATEST was saved after the last auto-commit (not in git yet). */
async function vaultWithUncommittedText() {
  git = isolatedGitEnv();
  t = await createVaultTestApp(PORT, {
    seed: (root) => {
      mkdirSync(path.join(root, '1 Projects'));
      writeFileSync(path.join(root, NOTE), V1);
    },
  });
  const timers = manualTimers();
  const history: HistoryService = await createHistoryPlugin({ env: git.env, timers }).start({
    context: t.context,
    settings: () => t!.settings,
    port: PORT,
    logger: t.context.logger,
  });
  t.context.attachPlugin(HISTORY_PLUGIN, history);
  await history.idle();
  const save = async (content: string) => {
    const { revision } = (await t!.call('GET', `/api/note?${q(NOTE)}`)).json();
    const res = await t!.call('PUT', '/api/note', {
      path: NOTE,
      content,
      expectedRevision: revision,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().revision as string;
  };
  await save(V2);
  timers.tick(); // the 10-minute auto-commit
  await history.idle();
  const latestRevision = await save(LATEST);
  const commits = (await t.call('GET', `/api/history?${q(NOTE)}`)).json().commits as {
    commit: string;
    message: string;
  }[];
  const oldest = commits.at(-1)!;
  const restore = () =>
    t!.call('POST', '/api/history/restore', {
      path: NOTE,
      commit: oldest.commit,
      expectedRevision: latestRevision,
    });
  return { t, history, restore, root: t.vaultRoot };
}

/** A fresh `index.lock` (a git that is still running) makes every commit fail. */
function blockCommits(root: string) {
  writeFileSync(path.join(root, '.git', 'index.lock'), '');
}

describe.skipIf(!HAS_GIT)('restoring a version never loses the text it replaces (F20.3)', () => {
  it('commits the pending text first, so it can be opened from history afterwards', async () => {
    const { t, restore } = await vaultWithUncommittedText();
    const res = await restore();
    expect(res.statusCode, res.body).toBe(200);
    expect((await t.call('GET', `/api/note?${q(NOTE)}`)).json().content).toBe(V1);

    const commits = (await t.call('GET', `/api/history?${q(NOTE)}`)).json().commits as {
      commit: string;
      message: string;
    }[];
    expect(commits[0]!.message).toMatch(/^restore: /);
    expect(commits[1]!.message).toMatch(/^auto: \d+ files$/);
    const replaced = await t.call(
      'GET',
      `/api/history/version?${q(NOTE)}&commit=${commits[1]!.commit}`,
    );
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().content).toBe(LATEST);
    expect(await t.context.vault.listTrash()).toEqual([]);
  });

  it('when that commit fails, the replaced text is kept in the trash before the write', async () => {
    const { t, restore, root } = await vaultWithUncommittedText();
    blockCommits(root);
    const res = await restore();
    expect(res.statusCode, res.body).toBe(200);
    expect((await t.call('GET', `/api/note?${q(NOTE)}`)).json().content).toBe(V1);
    expect(commitSubjects(root, git!.env)[0]).toBe('auto: 1 files'); // nothing could be committed
    const trash = await t.context.vault.listTrash();
    expect(trash).toEqual([
      expect.objectContaining({ reason: 'history-restore', originalPaths: [NOTE] }),
    ]);
    const kept = path.join(
      root,
      '.secondbrain',
      'trash',
      trash[0]!.id,
      'files',
      ...NOTE.split('/'),
    );
    expect(readFileSync(kept, 'utf8')).toBe(LATEST);
  });

  it('when neither works, the restore is refused (500 WRITE_FAILED) and nothing is written', async () => {
    const { t, restore, root } = await vaultWithUncommittedText();
    blockCommits(root);
    const trashDir = path.join(root, '.secondbrain', 'trash');
    renameSync(trashDir, `${trashDir} cũ`);
    writeFileSync(trashDir, 'not a folder'); // the trash cannot take a copy
    const res = await restore();
    expect(res.statusCode, res.body).toBe(500);
    expect(res.json().error.code).toBe('WRITE_FAILED');
    expect(readFileSync(path.join(root, NOTE), 'utf8')).toBe(LATEST);
    expect((await t.call('GET', `/api/note?${q(NOTE)}`)).json().content).toBe(LATEST);
  });
});
