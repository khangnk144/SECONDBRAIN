import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { answersAsGit } from '../../src/git/find-git-binary.js';
import { gitEnvironment } from '../../src/git/git-runner.js';
import type { HistoryTimers } from '../../src/git/history-plugin.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

/** Real git is needed; on a machine without it these suites are skipped (the app degrades). */
export const HAS_GIT = await answersAsGit('git');

/**
 * A home folder and an empty global config just for git, so the machine's own identity and
 * settings are never read or written (HOME, GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM).
 */
export function isolatedGitEnv(): {
  env: NodeJS.ProcessEnv;
  globalConfig: string;
  dispose(): void;
} {
  const home = makeTempDir('sb git home Lịch sử');
  const globalConfig = path.join(home, 'global.gitconfig');
  writeFileSync(globalConfig, '');
  return {
    env: {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: home,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
    },
    globalConfig,
    dispose: () => removeDir(home),
  };
}

/** Runs git in `cwd` with the isolated environment (for assertions and repo setup). */
export function gitIn(cwd: string, env: NodeJS.ProcessEnv, args: string[]): string {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd,
    env: gitEnvironment(env),
    encoding: 'utf8',
  });
}

/** Subjects of the commits on HEAD, newest first ([] without commits). */
export function commitSubjects(cwd: string, env: NodeJS.ProcessEnv): string[] {
  try {
    return gitIn(cwd, env, ['log', '--format=%s']).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/** Timers whose interval callback the test fires by hand ("10 minutes later"). */
export function manualTimers(): HistoryTimers & {
  tick(): void;
  intervalMs: number | null;
  cleared: boolean;
} {
  let callback: (() => void) | null = null;
  const timers = {
    intervalMs: null as number | null,
    cleared: false,
    setInterval(fn: () => void, ms: number) {
      callback = fn;
      timers.intervalMs = ms;
      return 1;
    },
    clearInterval() {
      timers.cleared = true;
      callback = null;
    },
    tick() {
      callback?.();
    },
  };
  return timers;
}
