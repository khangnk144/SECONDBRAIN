/**
 * Runs git for the vault's history (SPEC F20). Always `execFile` with an argument array (never a
 * shell), the vault root as working directory, no prompts and no optional locks, and a fixed set
 * of `-c` overrides so a repository config copied from elsewhere can neither run code (hooks,
 * fsmonitor, signing, pagers) nor change how output and line endings look.
 */
import { execFile } from 'node:child_process';

export const GIT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * A hooks folder that cannot hold files. An empty `core.hooksPath` would make git look for hooks
 * in the file-system root (`/pre-commit`), so the null device is used instead.
 */
export function noHooksPath(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'NUL' : '/dev/null';
}

/** Overrides put before every subcommand. */
export function gitSafetyArgs(root: string, platform: NodeJS.Platform): string[] {
  const settings = [
    'core.quotepath=off',
    'core.autocrlf=false',
    'core.safecrlf=false',
    'core.fsmonitor=false',
    `core.hooksPath=${noHooksPath(platform)}`,
    'core.longpaths=true',
    'commit.gpgsign=false',
    'log.showSignature=false',
    'color.ui=false',
    'i18n.logOutputEncoding=utf-8',
    // The vault may live on a drive git considers foreign (exFAT, another account's folder);
    // hooks and fsmonitor are off, so trusting exactly this folder is safe.
    `safe.directory=${root.replace(/\\/g, '/')}`,
  ];
  return [...settings.flatMap((setting) => ['-c', setting]), '--no-pager', '--literal-pathspecs'];
}

/**
 * The child's environment: the server's own minus every `GIT_*` variable (a `GIT_DIR` inherited
 * from wherever the server was started must never redirect git to another repository), plus no
 * prompts, no optional locks and the caller's additions (tests isolate HOME and global config).
 */
export function gitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.toUpperCase().startsWith('GIT_')) env[key] = value;
  }
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', ...extra };
}

/** A git command that failed; `code` is a short word for logs (never output, never paths). */
export class GitCommandError extends Error {
  constructor(
    readonly code: string,
    readonly exitCode: number | null,
  ) {
    super(`git failed (${code})`);
    this.name = 'GitCommandError';
  }
}

export interface GitRunOptions {
  maxBuffer?: number;
  /** Exit codes that are answers rather than failures (e.g. 1 for "not set"). */
  okExitCodes?: number[];
}

export interface GitRunResult {
  stdout: Buffer;
  exitCode: number;
}

export interface GitRunner {
  run(args: string[], options?: GitRunOptions): Promise<GitRunResult>;
}

export interface GitRunnerOptions {
  binary: string;
  root: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export function createGitRunner(options: GitRunnerOptions): GitRunner {
  const prefix = gitSafetyArgs(options.root, options.platform ?? process.platform);
  const env = gitEnvironment(options.env);
  return {
    run(args, runOptions = {}) {
      return new Promise((resolve, reject) => {
        execFile(
          options.binary,
          [...prefix, ...args],
          {
            cwd: options.root,
            env,
            encoding: 'buffer',
            timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
            maxBuffer: runOptions.maxBuffer ?? DEFAULT_MAX_BUFFER,
            windowsHide: true,
          },
          (error, stdout) => {
            if (!error) return resolve({ stdout, exitCode: 0 });
            const exitCode = typeof error.code === 'number' ? error.code : null;
            if (exitCode !== null && runOptions.okExitCodes?.includes(exitCode)) {
              return resolve({ stdout, exitCode });
            }
            const code = error.killed
              ? 'timeout'
              : exitCode !== null
                ? `exit-${exitCode}`
                : String(error.code ?? 'unknown');
            reject(new GitCommandError(code, exitCode));
          },
        );
      });
    },
  };
}
