import { describe, expect, it } from 'vitest';
import { parseFollowLog } from '../../src/git/note-history-log.js';
import { gitSafetyArgs, gitEnvironment, noHooksPath } from '../../src/git/git-runner.js';
import { gitCandidates } from '../../src/git/find-git-binary.js';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const H3 = 'c'.repeat(40);

describe('git log parsing for note history', () => {
  it('reads commits, renames and deletions from -z name-status output', () => {
    const output = [
      `\u001e${H1}\0aaaaaaa\x002026-10-21T09:00:00+07:00\0restore: 2 Areas/B.md @ ccccccc\0`,
      `\nM\x002 Areas/B.md\0`,
      `\u001e${H2}\0bbbbbbb\x002026-10-21T08:50:00+07:00\0auto: 3 files\0`,
      `\nR087\x001 Projects/Đồ án.md\x002 Areas/B.md\0`,
      `\u001e${H3}\0ccccccc\x002026-10-21T08:40:00+07:00\0auto: 12 files\0`,
      `\nA\x001 Projects/Đồ án.md\0`,
    ].join('');
    expect(parseFollowLog(output)).toEqual([
      {
        commit: H1,
        shortCommit: 'aaaaaaa',
        date: '2026-10-21T09:00:00+07:00',
        message: 'restore: 2 Areas/B.md @ ccccccc',
        auto: false,
        pathAtCommit: '2 Areas/B.md',
        gitPath: '2 Areas/B.md',
        deleted: false,
      },
      expect.objectContaining({ commit: H2, auto: true, pathAtCommit: '2 Areas/B.md' }),
      expect.objectContaining({ commit: H3, auto: true, pathAtCommit: '1 Projects/Đồ án.md' }),
    ]);
  });

  it('keeps paths byte-exact for git (NFD, leading spaces, capital letters) and flags deletions', () => {
    const nfd = 'Daily/Ghi chú.md'.normalize('NFD');
    const output = `\u001e${H1}\0aaaaaaa\0d\0auto: 1 files\0\nD\0${nfd}\0\u001e${H2}\0bbbbbbb\0d\0x\0\nM\0 Mở đầu.md\0`;
    const [deleted, spaced] = parseFollowLog(output);
    expect(deleted).toMatchObject({
      gitPath: nfd,
      pathAtCommit: nfd.normalize('NFC'),
      deleted: true,
    });
    expect(spaced).toMatchObject({ gitPath: ' Mở đầu.md', deleted: false });
  });
});

describe('git command safety', () => {
  it('turns off hooks, fsmonitor, signing and pagers, and uses literal pathspecs', () => {
    const args = gitSafetyArgs('D:\\SECONDBRAIN\\vault', 'win32');
    expect(args).toContain(`core.hooksPath=${noHooksPath('win32')}`);
    for (const setting of [
      'core.fsmonitor=false',
      'commit.gpgsign=false',
      'core.autocrlf=false',
      'core.quotepath=off',
      'log.showSignature=false',
      'safe.directory=D:/SECONDBRAIN/vault',
    ]) {
      expect(args).toContain(setting);
    }
    expect(args.slice(-2)).toEqual(['--no-pager', '--literal-pathspecs']);
    expect(noHooksPath('linux')).toBe('/dev/null');
  });

  it('never passes an inherited GIT_* variable (a GIT_DIR could redirect git elsewhere)', () => {
    const saved = { dir: process.env.GIT_DIR, tree: process.env.GIT_WORK_TREE };
    process.env.GIT_DIR = '/somewhere/else/.git';
    process.env.GIT_WORK_TREE = '/somewhere/else';
    try {
      const env = gitEnvironment({ GIT_CONFIG_NOSYSTEM: '1' });
      expect(env.GIT_DIR).toBeUndefined();
      expect(env.GIT_WORK_TREE).toBeUndefined();
      expect(env).toMatchObject({
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_CONFIG_NOSYSTEM: '1',
      });
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved.dir;
      if (saved.tree === undefined) delete process.env.GIT_WORK_TREE;
      else process.env.GIT_WORK_TREE = saved.tree;
    }
  });

  it('looks for Git for Windows in its install folders after the PATH', () => {
    expect(gitCandidates('linux', {})).toEqual(['git']);
    expect(
      gitCandidates('win32', {
        ProgramFiles: 'C:\\Program Files',
        ProgramW6432: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\khang\\AppData\\Local',
      }),
    ).toEqual([
      'git',
      'C:\\Program Files\\Git\\cmd\\git.exe',
      'C:\\Users\\khang\\AppData\\Local\\Programs\\Git\\cmd\\git.exe',
    ]);
  });
});
