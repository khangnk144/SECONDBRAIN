/**
 * One history commit of everything that changed in the vault (SPEC F20): the 10-minute and
 * on-close auto-commits and the commit right after a restore. Only `git status`, `add`, `diff`,
 * `commit` and `rev-parse` run here – nothing that touches the working tree.
 */
import { lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { GitRunner } from './git-runner.js';

export interface CommitResult {
  commit: string;
  /** Committer date, ISO 8601 with offset. */
  date: string;
  files: number;
}

const nulCount = (output: Buffer) => output.toString('utf8').split('\0').filter(Boolean).length;

/**
 * Removes `index.lock` when it is older than `staleMs` (a git process that crashed or was killed
 * left it behind); a fresher lock belongs to a running git and is kept. Only that one file is
 * ever removed. Returns what it found.
 */
export async function clearStaleIndexLock(
  git: GitRunner,
  root: string,
  staleMs: number,
  now: Date,
): Promise<'none' | 'removed' | 'fresh'> {
  const { stdout } = await git.run(['rev-parse', '--git-path', 'index.lock']);
  const lock = path.resolve(root, stdout.toString('utf8').replace(/\r?\n$/, ''));
  let mtimeMs: number;
  try {
    const info = await lstat(lock);
    if (!info.isFile()) return 'none';
    mtimeMs = info.mtimeMs;
  } catch {
    return 'none';
  }
  if (now.getTime() - mtimeMs <= staleMs) return 'fresh';
  await unlink(lock);
  return 'removed';
}

/** The newest commit, or null in a repository without commits. */
export async function lastCommit(git: GitRunner): Promise<Omit<CommitResult, 'files'> | null> {
  const head = await git.run(['rev-parse', '--verify', '-q', 'HEAD'], { okExitCodes: [1] });
  if (head.exitCode !== 0) return null;
  const { stdout } = await git.run(['log', '-1', '--format=%H%x00%cI', 'HEAD']);
  const [commit = '', date = ''] = stdout.toString('utf8').trim().split('\0');
  return { commit, date };
}

/**
 * Stages every change (`add -A`) and commits it with `message(n)`; null when nothing changed.
 * A file another program holds open is skipped (`--ignore-errors`) instead of blocking the commit.
 */
export async function commitVaultChanges(
  git: GitRunner,
  message: (files: number) => string,
): Promise<CommitResult | null> {
  // Untracked files always count, whatever `status.showUntrackedFiles` the user configured.
  const status = await git.run(['status', '--porcelain', '-z', '--untracked-files=normal']);
  if (nulCount(status.stdout) === 0) return null;
  // Exit 1 = some files could not be read (still a commit of the rest); 128 (a lock) throws.
  await git.run(['add', '-A', '--ignore-errors'], { okExitCodes: [1] });
  const staged = await git.run(['diff', '--cached', '--name-only', '-z']);
  const files = nulCount(staged.stdout);
  if (files === 0) return null;
  await git.run(['commit', '-q', '--no-verify', '-m', message(files)]);
  const head = await lastCommit(git);
  return head ? { ...head, files } : null;
}
