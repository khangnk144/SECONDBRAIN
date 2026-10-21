import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HistoryService } from '../../src/git/history-types.js';
import { commitSubjects, HAS_GIT, isolatedGitEnv, manualTimers } from './git-test-env.js';
import { openHistoryTestVault, type HistoryTestVault } from './history-test-vault.js';

const NOTE = '1 Projects/Đồ án Giải tích.md';
const V1 = '---\r\ntype: project\r\n---\r\n# Đồ án\r\n\r\nBản một.\r\n';
const V2 = '---\r\ntype: project\r\n---\r\n# Đồ án\r\n\r\nBản hai, sửa nhiều chỗ.\r\n';

describe.skipIf(!HAS_GIT)('note versions, renames and restore (F20.3)', () => {
  let vault: HistoryTestVault;
  let git: ReturnType<typeof isolatedGitEnv>;
  let history: HistoryService;

  afterEach(async () => {
    await vault?.close();
    git?.dispose();
  });

  async function setUp() {
    git = isolatedGitEnv();
    vault = await openHistoryTestVault({
      seed: (root) => {
        mkdirSync(path.join(root, '1 Projects'));
        writeFileSync(path.join(root, NOTE), V1);
      },
    });
    history = await vault.startHistory({ env: git.env, timers: manualTimers() });
    await history.idle();
  }

  async function write(notePath: string, text: string) {
    const { revision } = await vault.context.vault.read(notePath);
    return vault.context.vault.write(notePath, text, revision);
  }

  it('lists the commits of a note newest first and returns its bytes at each', async () => {
    await setUp();
    await write(NOTE, V2);
    await history.commitNow();
    const commits = await history.noteHistory(NOTE);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ message: 'auto: 1 files', auto: true, pathAtCommit: NOTE });
    expect(commits[0]!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(commits[0]!.commit.startsWith(commits[0]!.shortCommit)).toBe(true);
    expect(Date.parse(commits[0]!.date)).not.toBeNaN();
    expect(await history.noteVersion(NOTE, commits[1]!.commit)).toEqual({
      content: V1,
      pathAtCommit: NOTE,
    });
    expect((await history.noteVersion(NOTE, commits[0]!.shortCommit))?.content).toBe(V2);
  });

  it('follows a renamed note back to its old path', async () => {
    await setUp();
    await write(NOTE, V2);
    await history.commitNow();
    const renamed = '2 Areas/Giải tích – đồ án.md';
    const { revision } = await vault.context.vault.read(NOTE);
    await vault.context.vault.rename(NOTE, renamed, { expectedRevision: revision, relink: false });
    await history.commitNow();
    const commits = await history.noteHistory(renamed);
    expect(commits.map((entry) => entry.pathAtCommit)).toEqual([renamed, NOTE, NOTE]);
    const oldest = commits[2]!;
    expect(await history.noteVersion(renamed, oldest.commit)).toEqual({
      content: V1,
      pathAtCommit: NOTE,
    });
  });

  it('a version where the note did not exist is null; a non-UTF-8 version is refused', async () => {
    await setUp();
    const [first] = await history.noteHistory(NOTE);
    expect(await history.noteVersion('0 Inbox/Chưa có.md', first!.commit)).toBeNull();
    expect(await history.noteVersion(NOTE, 'abcdef1234')).toBeNull();
    await vault.context.vault.create(
      '0 Inbox/ansi.md',
      Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
    );
    await history.commitNow();
    const [ansi] = await history.noteHistory('0 Inbox/ansi.md');
    await expect(history.noteVersion('0 Inbox/ansi.md', ansi!.commit)).rejects.toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'not-utf8' },
    });
  });

  it('restore writes the old bytes through the vault, re-indexes and commits at once', async () => {
    await setUp();
    await write(NOTE, V2);
    await history.commitNow();
    const commits = await history.noteHistory(NOTE);
    const current = await vault.context.vault.read(NOTE);
    const result = await history.restore(NOTE, commits[1]!.commit, current.revision);
    expect((await vault.context.vault.read(NOTE)).content).toBe(V1);
    expect(vault.context.index.getNote(NOTE)?.revision).toBe(result.revision);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(commitSubjects(vault.root, git.env)[0]).toBe(
      `restore: ${NOTE} @ ${commits[1]!.shortCommit}`,
    );
    expect((await history.noteHistory(NOTE))[0]).toMatchObject({ auto: false });
  });

  it('restore refuses a stale revision (409) and a note deleted since (404)', async () => {
    await setUp();
    await write(NOTE, V2);
    await history.commitNow();
    const commits = await history.noteHistory(NOTE);
    const stale = (await vault.context.vault.read(NOTE)).revision;
    await write(NOTE, `${V2}Thêm một dòng.\r\n`);
    await expect(history.restore(NOTE, commits[1]!.commit, stale)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect((await vault.context.vault.read(NOTE)).content).toBe(`${V2}Thêm một dòng.\r\n`);
    const { revision } = await vault.context.vault.read(NOTE);
    await vault.context.vault.trash([NOTE], [revision]);
    await expect(history.restore(NOTE, commits[1]!.commit, revision)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
