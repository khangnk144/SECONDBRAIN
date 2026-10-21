/**
 * Finds a working git (SPEC F20: git is optional). `git` on PATH first; on Windows also the usual
 * Git for Windows install folders, because an install made after login is not on the PATH the
 * launcher inherited.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { gitEnvironment } from './git-runner.js';

const VERSION_TIMEOUT_MS = 10_000;

export function gitCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return ['git'];
  const roots = [
    env.ProgramFiles,
    env.ProgramW6432,
    env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs'),
  ];
  const installed = roots
    .filter((root): root is string => typeof root === 'string' && root !== '')
    .map((root) => path.win32.join(root, 'Git', 'cmd', 'git.exe'));
  return ['git', ...new Set(installed)];
}

/** True when `binary --version` answers like git. */
export function answersAsGit(binary: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      binary,
      ['--version'],
      { env: gitEnvironment(env), timeout: VERSION_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => resolve(!error && String(stdout).startsWith('git version')),
    );
  });
}

export interface FindGitOptions {
  /** Only this binary is tried (tests pass a bogus one to simulate "git missing"). */
  gitBinary?: string;
  platform?: NodeJS.Platform;
  /** Extra environment for the probe (and the lookup of the Windows install folders). */
  env?: NodeJS.ProcessEnv;
}

export async function findGitBinary(options: FindGitOptions = {}): Promise<string | null> {
  const env = { ...process.env, ...options.env };
  const candidates = options.gitBinary
    ? [options.gitBinary]
    : gitCandidates(options.platform ?? process.platform, env);
  for (const candidate of candidates) {
    if (await answersAsGit(candidate, options.env)) return candidate;
  }
  return null;
}
