import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EXCLUDE_RULES } from '../../src/git/prepare-vault-repository.js';
import { commitSubjects, gitIn, HAS_GIT, isolatedGitEnv, manualTimers } from './git-test-env.js';
import {
  editNote,
  openHistoryTestVault,
  openSeededHistoryVault,
  type SeededHistoryVault,
} from './history-test-vault.js';

const MINUTE = 60_000;

describe.skipIf(!HAS_GIT)('git version history plugin (F20.3)', () => {
  let fixture: SeededHistoryVault | null = null;
  afterEach(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  async function open(seed?: (root: string, env: NodeJS.ProcessEnv) => void) {
    fixture = await openSeededHistoryVault(seed);
    return fixture;
  }

  it('creates the repository with exclude rules, a local identity and a first commit', async () => {
    const { vault, env, git } = await open();
    const service = await vault.startHistory({ env, timers: manualTimers() });
    await service.idle();
    expect(existsSync(path.join(vault.root, '.git'))).toBe(true);
    expect(existsSync(path.join(vault.root, '.gitignore'))).toBe(false);
    const exclude = readFileSync(path.join(vault.root, '.git', 'info', 'exclude'), 'utf8');
    for (const rule of EXCLUDE_RULES) expect(exclude.split('\n')).toContain(rule);
    expect(gitIn(vault.root, env, ['config', '--local', 'user.name']).trim()).toBe('Second Brain');
    expect(gitIn(vault.root, env, ['config', '--local', 'user.email']).trim()).toBe(
      'second-brain@localhost',
    );
    expect(readFileSync(git.globalConfig, 'utf8')).toBe('');
    const tracked = gitIn(vault.root, env, ['ls-files']).split('\n').filter(Boolean);
    expect(tracked).toContain('.secondbrain/vault.json');
    expect(tracked).toContain('CLAUDE.md');
    expect(tracked.some((file) => file.startsWith('.secondbrain/cache/'))).toBe(false);
    expect(tracked.some((file) => file.startsWith('.secondbrain/logs/'))).toBe(false);
    // The message counts her files; app state under `.secondbrain/` is committed, not counted.
    const counted = tracked.filter((file) => !file.startsWith('.secondbrain/')).length;
    expect(commitSubjects(vault.root, env)).toEqual([`auto: ${counted} files`]);
    const status = service.status();
    expect(status).toMatchObject({ available: true });
    expect(status.lastCommitAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps an identity that is already configured (repo-local or global)', async () => {
    const { vault, env } = await open((root, gitEnv) => {
      gitIn(root, gitEnv, ['init', '-q']);
      gitIn(root, gitEnv, ['config', 'user.name', 'Khang']);
      gitIn(root, gitEnv, ['config', 'user.email', 'khang@example.com']);
    });
    const service = await vault.startHistory({ env, timers: manualTimers() });
    await editNote(vault, service, 'một\n');
    await service.commitNow();
    expect(gitIn(vault.root, env, ['log', '-1', '--format=%an <%ae>']).trim()).toBe(
      'Khang <khang@example.com>',
    );
    // The repository existed: no first commit was made on start, only the one asked for.
    expect(commitSubjects(vault.root, env)).toHaveLength(1);

    const second = isolatedGitEnv();
    writeFileSync(second.globalConfig, '[user]\n\tname = Global Name\n\temail = g@example.com\n');
    const other = await openHistoryTestVault();
    try {
      const otherService = await other.startHistory({ env: second.env, timers: manualTimers() });
      await otherService.idle();
      const local = gitIn(other.root, second.env, ['config', '--local', '--list']);
      expect(local).not.toContain('user.name');
      expect(gitIn(other.root, second.env, ['log', '-1', '--format=%an']).trim()).toBe(
        'Global Name',
      );
    } finally {
      await other.close();
      second.dispose();
    }
  });

  it('auto-commits every 10 minutes when something changed, and only then', async () => {
    const { vault, env } = await open();
    const timers = manualTimers();
    const service = await vault.startHistory({ env, timers });
    await service.idle();
    expect(timers.intervalMs).toBe(10 * MINUTE);
    await editNote(vault, service, 'Bản đầu\n');
    timers.tick();
    await service.idle();
    expect(commitSubjects(vault.root, env)[0]).toBe('auto: 1 files');
    const count = commitSubjects(vault.root, env).length;
    timers.tick();
    await service.idle();
    expect(commitSubjects(vault.root, env)).toHaveLength(count);
  });

  it('without git: available false, no timer, the vault still saves', async () => {
    const { vault, env } = await open();
    const timers = manualTimers();
    const service = await vault.startHistory({
      env,
      timers,
      gitBinary: path.join(vault.home, 'no such git', 'git'),
    });
    expect(service.status()).toEqual({
      available: false,
      reason: 'git-missing',
      lastCommitAt: null,
    });
    expect(timers.intervalMs).toBeNull();
    const written = await vault.context.vault.create('0 Inbox/Vẫn lưu.md', 'ok\n');
    expect(written.revision).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(path.join(vault.root, '.git'))).toBe(false);
    await expect(service.noteHistory('0 Inbox/Vẫn lưu.md')).rejects.toMatchObject({
      reason: 'git-missing',
    });
    await service.close();
  });

  it('a repository git cannot open → init-failed, nothing else affected', async () => {
    const { vault, env } = await open((root) => writeFileSync(path.join(root, '.git'), 'rác\n'));
    const service = await vault.startHistory({ env, timers: manualTimers() });
    expect(service.status()).toMatchObject({ available: false, reason: 'init-failed' });
    expect(readFileSync(path.join(vault.root, '.git'), 'utf8')).toBe('rác\n');
    await vault.context.vault.create('0 Inbox/Vẫn lưu.md', 'ok\n');
    expect(
      vault.logger.lines.some((line) => line.includes('preparing the git repository failed')),
    ).toBe(true);
  });
});
