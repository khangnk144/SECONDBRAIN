import { existsSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitSubjects, HAS_GIT, manualTimers } from './git-test-env.js';
import {
  editNote,
  openSeededHistoryVault,
  SEEDED_NOTE,
  type SeededHistoryVault,
} from './history-test-vault.js';

const MINUTE = 60_000;

describe.skipIf(!HAS_GIT)('history: stale git locks and the commit on close (F20.3)', () => {
  let fixture: SeededHistoryVault | null = null;
  afterEach(async () => {
    await fixture?.dispose();
    fixture = null;
  });

  it('removes a stale index.lock, keeps a fresh one and commits on a later beat', async () => {
    fixture = await openSeededHistoryVault();
    const { vault, env } = fixture;
    let clock = Date.now();
    const timers = manualTimers();
    const service = await vault.startHistory({ env, timers, now: () => new Date(clock) });
    await service.idle();
    const before = commitSubjects(vault.root, env).length;
    const lock = path.join(vault.root, '.git', 'index.lock');
    writeFileSync(lock, '');
    await editNote(vault, service, 'khi git khác đang chạy\n');
    timers.tick();
    await service.idle();
    expect(existsSync(lock)).toBe(true);
    expect(commitSubjects(vault.root, env)).toHaveLength(before);
    expect(vault.logger.lines.some((line) => line.includes('commit failed (exit-128)'))).toBe(true);

    clock += 11 * MINUTE;
    timers.tick();
    await service.idle();
    expect(existsSync(lock)).toBe(false);
    expect(commitSubjects(vault.root, env)).toHaveLength(before + 1);
    expect(vault.logger.lines.some((line) => line.includes('removed a stale git index lock'))).toBe(
      true,
    );
    // Logs carry codes and counts only, never paths or note text.
    expect(vault.logger.lines.join('\n')).not.toMatch(/Ghi chú|git khác|\.lock/);
  });

  it('a lock written 11 minutes ago on disk counts as stale with the real clock', async () => {
    fixture = await openSeededHistoryVault();
    const { vault, env } = fixture;
    const service = await vault.startHistory({ env, timers: manualTimers() });
    await service.idle();
    const lock = path.join(vault.root, '.git', 'index.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 11 * MINUTE);
    utimesSync(lock, old, old);
    await editNote(vault, service, 'sau khi git bị dừng giữa chừng\n');
    expect(await service.commitNow()).toMatchObject({ files: 1 });
    expect(existsSync(lock)).toBe(false);
  });

  it('commits once more on close and refuses requests afterwards', async () => {
    fixture = await openSeededHistoryVault();
    const { vault, env } = fixture;
    const timers = manualTimers();
    const service = await vault.startHistory({ env, timers });
    await service.idle();
    await editNote(vault, service, 'viết ngay trước khi tắt\n');
    await service.close();
    expect(timers.cleared).toBe(true);
    expect(commitSubjects(vault.root, env)[0]).toBe('auto: 1 files');
    await expect(service.noteHistory(SEEDED_NOTE)).rejects.toMatchObject({ reason: 'closed' });
  });

  it('closing the vault context closes the plugin, which commits first', async () => {
    fixture = await openSeededHistoryVault();
    const { vault, env } = fixture;
    const service = await vault.startHistory({ env, timers: manualTimers() });
    await service.idle();
    await editNote(vault, service, 'tắt server\n');
    await vault.context.close();
    expect(commitSubjects(vault.root, env)[0]).toBe('auto: 1 files');
  });

  it.skipIf(process.platform === 'win32')(
    'close waits at most the configured time for a git that hangs',
    async () => {
      fixture = await openSeededHistoryVault();
      const { vault, env } = fixture;
      const slowGit = path.join(vault.home, 'slow git.sh');
      writeFileSync(
        slowGit,
        '#!/bin/sh\nfor a in "$@"; do [ "$a" = commit ] && sleep 3; done\nexec git "$@"\n',
        { mode: 0o755 },
      );
      const service = await vault.startHistory({
        env,
        timers: manualTimers(),
        gitBinary: slowGit,
        closeTimeoutMs: 200,
      });
      await service.idle();
      await editNote(vault, service, 'chậm\n');
      const started = Date.now();
      await service.close();
      expect(Date.now() - started).toBeLessThan(2000);
      await new Promise((resolve) => setTimeout(resolve, 3500)); // let the slow commit finish
    },
    15_000,
  );
});
