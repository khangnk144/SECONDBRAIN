/**
 * Pushes the vault's history repository (SPEC F20) to a private GitHub repository (F27.5):
 * `git push <url> HEAD:refs/heads/<branch>`, no remote is added. The token reaches git only for
 * this one command, through `GIT_CONFIG_COUNT/KEY/VALUE` in the child's environment
 * (`http.extraheader`): never in the argument list, never in `.git/config`, never logged.
 * Credential helpers and prompts are off (a Windows credential manager must not pop up a login
 * window from a background push). Failures are classified from git's English stderr into plain
 * codes; the stderr itself is dropped (it may name the URL). An abort (`signal`, the app closing)
 * kills the git child at once and answers `interrupted`, instead of holding a vault switch or
 * "Thoát" for up to `PUSH_TIMEOUT_MS`.
 */
import { execFile } from 'node:child_process';
import { gitEnvironment, gitSafetyArgs } from './git-runner.js';

export const PUSH_TIMEOUT_MS = 180_000;

export type GitPushFailure = 'auth' | 'network' | 'rejected' | 'interrupted' | 'failed';

export type GitPushResult = { ok: true } | { ok: false; error: GitPushFailure };

/** What actually starts the process (tests record the call instead). */
export type PushExec = (
  binary: string,
  args: readonly string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; signal?: AbortSignal },
) => Promise<{ exitCode: number | null; stderr: string; timedOut: boolean; aborted?: boolean }>;

export interface GitPushInput {
  binary: string;
  root: string;
  remoteUrl: string;
  branch: string;
  token: string;
  platform?: NodeJS.Platform;
  /** Extra environment (tests isolate HOME and the global config). */
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  exec?: PushExec;
  /** Aborted when the app closes: git is killed and the push answers `interrupted`. */
  signal?: AbortSignal;
}

/** The environment entries that hand the token to git for one command. */
export function authHeaderEnv(token: string): Record<string, string> {
  const basic = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

export function pushArgs(
  root: string,
  platform: NodeJS.Platform,
  remoteUrl: string,
  branch: string,
): string[] {
  return [
    ...gitSafetyArgs(root, platform),
    // An empty value resets the helper list: no stored credential is used, none is stored.
    '-c',
    'credential.helper=',
    '-c',
    'credential.interactive=never',
    '-c',
    'core.askPass=',
    'push',
    '--porcelain',
    '--no-verify',
    remoteUrl,
    `HEAD:refs/heads/${branch}`,
  ];
}

const AUTH = [
  /authentication failed/i,
  /could not read (username|password)/i,
  /invalid username or password/i,
  /terminal prompts disabled/i,
  /returned error: 40[13]/i,
  /permission to .* denied/i,
  /repository not found/i, // GitHub's answer for a private repository the token cannot see
  /bad credentials/i,
];
const REJECTED = [
  /\[rejected\]/i,
  /\[remote rejected\]/i,
  /non-fast-forward/i,
  /fetch first/i,
  /protected branch/i,
  /failed to push some refs/i,
];
const NETWORK = [
  /could not resolve host/i,
  /failed to connect/i,
  /connection (timed out|refused|reset)/i,
  /couldn't connect/i,
  /network is unreachable/i,
  /operation timed out/i,
  /ssl|tls|certificate/i,
  /unable to access/i,
  /early eof|the remote end hung up/i,
  /returned error: 5\d\d/i,
];

export function classifyPushFailure(stderr: string, timedOut: boolean): GitPushFailure {
  if (timedOut) return 'network';
  if (AUTH.some((pattern) => pattern.test(stderr))) return 'auth';
  if (REJECTED.some((pattern) => pattern.test(stderr))) return 'rejected';
  if (NETWORK.some((pattern) => pattern.test(stderr))) return 'network';
  return 'failed';
}

const defaultExec: PushExec = (binary, args, options) =>
  new Promise((resolve) => {
    execFile(
      binary,
      [...args],
      { ...options, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, _stdout, stderr) => {
        if (!error) return resolve({ exitCode: 0, stderr: '', timedOut: false });
        if (options.signal?.aborted)
          return resolve({ exitCode: null, stderr: '', timedOut: false, aborted: true });
        const exitCode = typeof error.code === 'number' ? error.code : null;
        resolve({ exitCode, stderr: String(stderr ?? ''), timedOut: error.killed === true });
      },
    );
  });

export async function pushVaultHistory(input: GitPushInput): Promise<GitPushResult> {
  if (input.signal?.aborted) return { ok: false, error: 'interrupted' };
  const platform = input.platform ?? process.platform;
  const env = gitEnvironment({
    ...input.env,
    // English messages, so the failure can be classified on any Windows display language.
    LC_ALL: 'C',
    LANG: 'C',
    LANGUAGE: 'C',
    GIT_ASKPASS: '',
    SSH_ASKPASS: '',
    GCM_INTERACTIVE: 'never',
    ...authHeaderEnv(input.token),
  });
  const result = await (input.exec ?? defaultExec)(
    input.binary,
    pushArgs(input.root, platform, input.remoteUrl, input.branch),
    { cwd: input.root, env, timeout: input.timeoutMs ?? PUSH_TIMEOUT_MS, signal: input.signal },
  );
  if (result.aborted || input.signal?.aborted) return { ok: false, error: 'interrupted' };
  if (result.exitCode === 0 && !result.timedOut) return { ok: true };
  return { ok: false, error: classifyPushFailure(result.stderr, result.timedOut) };
}
