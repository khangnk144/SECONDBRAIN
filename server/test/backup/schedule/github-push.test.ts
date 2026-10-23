import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createHistoryPlugin } from '../../../src/git/history-plugin.js';
import {
  authHeaderEnv,
  classifyPushFailure,
  pushVaultHistory,
  type PushExec,
} from '../../../src/git/git-push.js';
import { makeClock } from '../../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';
import { HAS_GIT, gitIn, isolatedGitEnv, manualTimers } from '../../git/git-test-env.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';
import { at, startSchedule, tick, waitIdle } from './schedule-test-host.js';

const TOKEN = 'ghp_PUSHSECRET0000000000000000000000zzzz';
const BASIC = Buffer.from(`x-access-token:${TOKEN}`).toString('base64');

let t: VaultTestApp | undefined;
let git: ReturnType<typeof isolatedGitEnv> | undefined;
let remoteDir: string | undefined;
afterEach(async () => {
  await t?.close();
  git?.dispose();
  if (remoteDir) removeDir(remoteDir);
  t = undefined;
  git = undefined;
  remoteDir = undefined;
});

/** Every file under `dir` as text (to scan for the token). */
function allText(dir: string): string {
  let out = '';
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    out += statSync(abs).isDirectory() ? allText(abs) : readFileSync(abs).toString('latin1');
  }
  return out;
}

async function setup(start: Date) {
  git = isolatedGitEnv();
  const clock = makeClock(start);
  t = await createVaultTestApp(47862, {
    now: clock.now,
    watcher: false,
    plugins: [createHistoryPlugin({ env: git.env, timers: manualTimers() })],
  });
  await t.context.vault.create('1 Projects/Đồ án Giải tích.md', '# Đồ án\n');
  await t.context.settled();
  remoteDir = makeTempDir('sb remote GitHub');
  const bare = path.join(remoteDir, 'kho riêng.git');
  execFileSync('git', ['init', '-q', '--bare', bare], { env: { ...process.env, ...git.env } });
  Object.assign(t.settings.backup.github, {
    enabled: true,
    remoteUrl: pathToFileURL(bare).href,
    branch: 'main',
    token: TOKEN,
  });
  return { clock, t, bare, env: git.env };
}

describe.skipIf(!HAS_GIT)('push of the history repository to GitHub (F27.5)', () => {
  it('(F27.5) "Đẩy ngay" commits what is pending and pushes HEAD; the token is nowhere on disk or in logs', async () => {
    const { clock, t, bare, env } = await setup(at(2026, 10, 22, 12, 0));
    const s = await startSchedule(t, { now: clock.now, allowFileRemote: true, gitEnv: env });
    await t.context.vault.create('0 Inbox/Ý tưởng mới.md', 'ghi nhanh\n');
    await t.context.settled();

    expect(await s.service.pushNow()).toEqual({ at: clock.now().toISOString(), ok: true });
    const files = gitIn(bare, env, ['ls-tree', '-r', '--name-only', 'main']);
    expect(files).toContain('0 Inbox/Ý tưởng mới.md');
    expect(files).toContain('1 Projects/Đồ án Giải tích.md');

    const dotGit = allText(path.join(t.vaultRoot, '.git')) + allText(bare);
    expect(dotGit.includes(TOKEN)).toBe(false);
    expect(dotGit.includes(BASIC)).toBe(false);
    expect(readFileSync(path.join(t.vaultRoot, '.git', 'config'), 'utf8')).not.toContain(
      'extraheader',
    );
    expect(s.logger.lines.join('\n')).not.toContain(TOKEN);
    const status = await s.service.status();
    expect(status.github).toMatchObject({ enabled: true, configured: true, git: 'ok' });
    expect(status.github.lastPush).toMatchObject({ ok: true });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
  });

  it('(F27.5) pushes after each scheduled backup; a rejected push is said in plain words', async () => {
    const { clock, t, bare, env } = await setup(at(2026, 10, 22, 20, 0));
    t.settings.backup.schedule.enabled = true;
    const s = await startSchedule(t, { now: clock.now, allowFileRemote: true, gitEnv: env });
    clock.set(at(2026, 10, 22, 21, 0));
    await tick(s);
    expect((await s.service.status()).github.lastPush).toEqual({
      at: at(2026, 10, 22, 21, 0).toISOString(),
      ok: true,
    });

    // Someone else pushed a different history to main: never overwritten.
    const other = path.join(remoteDir as string, 'clone khác');
    gitIn(remoteDir as string, env, ['clone', '-q', '-b', 'main', bare, other]);
    gitIn(other, env, [
      '-c',
      'user.name=x',
      '-c',
      'user.email=x@y',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'khác',
    ]);
    gitIn(other, env, ['push', '-q', 'origin', 'HEAD:main']);
    await t.context.vault.create('0 Inbox/Mới.md', 'x\n');
    await t.context.settled();
    expect(await s.service.pushNow()).toMatchObject({ ok: false, error: 'rejected' });
    await waitIdle(s.service);
    expect((await s.service.status()).github.lastPush).toMatchObject({
      ok: false,
      error: 'rejected',
    });
  });

  it('(F27.5) only https remotes in production; git missing disables it with a reason', async () => {
    const { clock, t, env } = await setup(at(2026, 10, 22, 12, 0));
    const production = await startSchedule(t, { now: clock.now, gitEnv: env });
    expect(await production.service.pushNow()).toMatchObject({
      ok: false,
      error: 'not-configured',
    });
    expect((await production.service.status()).github.configured).toBe(false);
    await production.service.close();

    const noGit = await startSchedule(t, {
      now: clock.now,
      allowFileRemote: true,
      gitEnv: env,
      gitBinary: 'git-that-does-not-exist',
    });
    expect(await noGit.service.pushNow()).toMatchObject({ ok: false, error: 'no-git' });
  });
});

describe.skipIf(!HAS_GIT)('a push never holds up closing the vault (F27.5)', () => {
  it('(F27.5) closing stops a push in flight at once and records it as interrupted', async () => {
    const { clock, t, env } = await setup(at(2026, 10, 22, 12, 0));
    let started = false;
    const exec: PushExec = (_binary, _args, options) =>
      new Promise((resolve) => {
        started = true;
        options.signal?.addEventListener('abort', () =>
          resolve({ exitCode: null, stderr: '', timedOut: false, aborted: true }),
        );
      });
    const s = await startSchedule(t, { now: clock.now, allowFileRemote: true, gitEnv: env, exec });
    const pushing = s.service.pushNow();
    for (let i = 0; i < 200 && !started; i += 1) await new Promise((r) => setTimeout(r, 10));
    expect(started).toBe(true);
    const begin = Date.now();
    await s.service.close();
    expect(Date.now() - begin).toBeLessThan(1_000);
    expect(await pushing).toMatchObject({ ok: false, error: 'interrupted' });
    const record = JSON.parse(
      readFileSync(path.join(t.home, '.secondbrain', 'backups.json'), 'utf8'),
    ).vaults[t.context.vault.id];
    expect(record.push).toMatchObject({ ok: false, error: 'interrupted' });
  });
});

describe('the push command itself (F27.5)', () => {
  it.skipIf(process.platform === 'win32')(
    '(F27.5) an abort kills the git child and answers interrupted (no 3-minute wait)',
    async () => {
      const dir = makeTempDir('sb git treo');
      try {
        const fakeGit = path.join(dir, 'git');
        writeFileSync(fakeGit, '#!/bin/sh\nsleep 30\n', { mode: 0o755 });
        const closing = new AbortController();
        const begin = Date.now();
        const pushing = pushVaultHistory({
          binary: fakeGit,
          root: dir,
          remoteUrl: 'https://github.com/a/b.git',
          branch: 'main',
          token: TOKEN,
          signal: closing.signal,
        });
        setTimeout(() => closing.abort(), 100);
        expect(await pushing).toEqual({ ok: false, error: 'interrupted' });
        expect(Date.now() - begin).toBeLessThan(5_000);
      } finally {
        removeDir(dir);
      }
    },
  );

  it('(F27.5) the token is only in the child environment, never in the argument list', async () => {
    const calls: { args: readonly string[]; env: NodeJS.ProcessEnv }[] = [];
    const exec: PushExec = async (_binary, args, options) => {
      calls.push({ args, env: options.env });
      return { exitCode: 0, stderr: '', timedOut: false };
    };
    const result = await pushVaultHistory({
      binary: 'git',
      root: '/kho',
      remoteUrl: 'https://github.com/khangnie/second-brain.git',
      branch: 'main',
      token: TOKEN,
      exec,
    });
    expect(result).toEqual({ ok: true });
    const [call] = calls;
    const argv = call?.args.join(' ') ?? '';
    expect(argv).not.toContain(TOKEN);
    expect(argv).not.toContain(BASIC);
    expect(argv).toContain('credential.helper=');
    expect(call?.args.slice(-2)).toEqual([
      'https://github.com/khangnie/second-brain.git',
      'HEAD:refs/heads/main',
    ]);
    expect(call?.env).toMatchObject({
      ...authHeaderEnv(TOKEN),
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      LC_ALL: 'C',
    });
    expect(call?.env.GIT_CONFIG_VALUE_0).toBe(`AUTHORIZATION: basic ${BASIC}`);
  });

  it('(F27.5) failures map to auth, network, rejected; the stderr itself is never kept', async () => {
    const cases: [string, ReturnType<typeof classifyPushFailure>][] = [
      ["fatal: Authentication failed for 'https://github.com/a/b.git/'", 'auth'],
      ['remote: Repository not found.\nfatal: repository not found', 'auth'],
      ["fatal: unable to access '…': The requested URL returned error: 403", 'auth'],
      ["fatal: unable to access '…': Could not resolve host: github.com", 'network'],
      ['fatal: unable to access: Failed to connect to github.com port 443', 'network'],
      [
        ' ! [rejected]        HEAD -> main (fetch first)\nerror: failed to push some refs',
        'rejected',
      ],
      ['remote: error: GH006: Protected branch update failed', 'rejected'],
      ['something unexpected', 'failed'],
    ];
    for (const [stderr, expected] of cases)
      expect(classifyPushFailure(stderr, false)).toBe(expected);
    expect(classifyPushFailure('', true)).toBe('network');
    const result = await pushVaultHistory({
      binary: 'git',
      root: '/kho',
      remoteUrl: 'https://github.com/a/b.git',
      branch: 'main',
      token: TOKEN,
      exec: async () => ({
        exitCode: 128,
        stderr: `fatal: Authentication failed ${TOKEN}`,
        timedOut: false,
      }),
    });
    expect(result).toEqual({ ok: false, error: 'auth' });
  });
});
