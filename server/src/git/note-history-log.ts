/**
 * A note's history from git (SPEC F20): the commits that touched it, newest first, following
 * renames, and its bytes at one of them. Paths are passed exactly as the file system spells them
 * (git stores those bytes) and as literal pathspecs.
 */
import { GitCommandError, type GitRunner } from './git-runner.js';

export const MAX_HISTORY_COMMITS = 200;
const MAX_VERSION_BYTES = 256 * 1024 * 1024;

export interface HistoryCommit {
  commit: string;
  shortCommit: string;
  /** Committer date, ISO 8601 with offset. */
  date: string;
  /** Subject line. */
  message: string;
  /** Made by the 10-minute / on-close auto-commit. */
  auto: boolean;
  /** The note's path in that commit (NFC, forward slashes). */
  pathAtCommit: string;
}

/** `pathAtCommit` as git spells it, plus whether the commit deleted the note. */
export interface RawHistoryCommit extends HistoryCommit {
  gitPath: string;
  deleted: boolean;
}

const RECORD = '\u001e';

/**
 * Parses `git log --format=%x1e%H%x00%h%x00%cI%x00%s --name-status -z` output: one record per
 * commit, its fields NUL-separated, then `<status>\0<path>\0` (`R…`/`C…` carry two paths).
 */
export function parseFollowLog(output: string): RawHistoryCommit[] {
  const commits: RawHistoryCommit[] = [];
  for (const record of output.split(RECORD)) {
    if (record === '') continue;
    const [commit = '', shortCommit = '', date = '', message = '', ...fields] = record.split('\0');
    let gitPath = '';
    let deleted = false;
    for (let i = 0; i < fields.length; i += 1) {
      // The first status follows the format's line break; paths are never trimmed.
      const status = fields[i]!.replace(/^\n+/, '');
      if (!/^[A-Z]/.test(status)) continue;
      const twoPaths = status.startsWith('R') || status.startsWith('C');
      gitPath = (twoPaths ? fields[i + 2] : fields[i + 1]) ?? gitPath;
      deleted = status === 'D';
      i += twoPaths ? 2 : 1;
    }
    if (commit === '' || gitPath === '') continue;
    commits.push({
      commit,
      shortCommit,
      date,
      message,
      auto: message.startsWith('auto: '),
      pathAtCommit: gitPath.normalize('NFC'),
      gitPath,
      deleted,
    });
  }
  return commits;
}

async function hasCommits(git: GitRunner): Promise<boolean> {
  const head = await git.run(['rev-parse', '--verify', '-q', 'HEAD'], { okExitCodes: [1] });
  return head.exitCode === 0;
}

export async function noteHistoryCommits(
  git: GitRunner,
  gitPath: string,
): Promise<RawHistoryCommit[]> {
  if (!(await hasCommits(git))) return [];
  const { stdout } = await git.run([
    'log',
    '--follow',
    `--max-count=${MAX_HISTORY_COMMITS}`,
    '--format=%x1e%H%x00%h%x00%cI%x00%s',
    '--name-status',
    '-z',
    '--',
    gitPath,
  ]);
  return parseFollowLog(stdout.toString('utf8'));
}

/** The file's bytes at `commit`, or null when it did not exist there. */
export async function blobAtCommit(
  git: GitRunner,
  commit: string,
  gitPath: string,
): Promise<Buffer | null> {
  const object = await git.run(['rev-parse', '--verify', '-q', `${commit}:${gitPath}`], {
    okExitCodes: [1, 128],
  });
  if (object.exitCode !== 0) return null;
  const id = object.stdout.toString('utf8').trim();
  try {
    const { stdout } = await git.run(['cat-file', 'blob', id], { maxBuffer: MAX_VERSION_BYTES });
    return stdout;
  } catch (error) {
    // A folder of that name at that commit (a tree, not a blob) is "no such note".
    if (error instanceof GitCommandError && error.exitCode === 128) return null;
    throw error;
  }
}
