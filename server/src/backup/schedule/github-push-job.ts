/**
 * "Đẩy lên GitHub" (SPEC F27.5): commits what is pending in the vault's history repository (the
 * history plugin's own auto-commit), then pushes HEAD to `backup.github.remoteUrl` on
 * `backup.github.branch` with the token for that one command. Production accepts only
 * `https://` remotes without credentials; `allowFileRemote` (tests only) also takes `file://`
 * so the push can be checked against a local bare repository.
 */
import { errorCodeOf } from '../../app-context/app-context-errors.js';
import type { AppContext } from '../../app-context/create-app-context.js';
import { HISTORY_PLUGIN } from '../../app-context/vault-plugins.js';
import type { BackupGithubSettings } from '../../config/settings-sections-m5.js';
import { GIT_BRANCH_PATTERN, isSafeRemoteUrl } from '../../config/settings-sections-m5.js';
import { findGitBinary } from '../../git/find-git-binary.js';
import { pushVaultHistory, type PushExec } from '../../git/git-push.js';
import type { HistoryService } from '../../git/history-types.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import type { PushRecord } from './schedule-types.js';

export interface PushOptions {
  gitBinary?: string;
  /** Extra environment for git (tests isolate HOME and the global config). */
  gitEnv?: NodeJS.ProcessEnv;
  /** Test-only: also accept `file://` remotes (a local bare repository). */
  allowFileRemote?: boolean;
  exec?: PushExec;
  platform?: NodeJS.Platform;
}

export interface PushDeps extends PushOptions {
  context: AppContext;
  github: () => BackupGithubSettings;
  now: () => Date;
  logger: AppLogger;
  /** Aborted when the plugin closes: git is stopped and the push records `interrupted`. */
  signal?: AbortSignal;
}

/** Remote URL and token set, and the URL one the push may use. */
export function pushConfigured(github: BackupGithubSettings, allowFileRemote = false): boolean {
  const url: string | null = github.remoteUrl;
  const fileUrl = allowFileRemote && typeof url === 'string' && url.startsWith('file://');
  const urlOk = fileUrl || isSafeRemoteUrl(url);
  return urlOk && typeof github.token === 'string' && github.token !== '';
}

/** Why pushing is impossible on this vault: git missing, or the history repository is off. */
export function historyState(context: AppContext): 'ok' | 'missing' | 'no-history' {
  const history = context.plugin<HistoryService>(HISTORY_PLUGIN);
  if (!history) return 'no-history';
  const status = history.status();
  if (status.available) return 'ok';
  return status.reason === 'git-missing' ? 'missing' : 'no-history';
}

/** One push; never throws. `at` is when it started. */
export async function pushToGithub(deps: PushDeps): Promise<PushRecord> {
  const at = deps.now().toISOString();
  const github = deps.github();
  const fail = (error: PushRecord['error']): PushRecord => ({ at, ok: false, error });
  if (!pushConfigured(github, deps.allowFileRemote) || !GIT_BRANCH_PATTERN.test(github.branch))
    return fail('not-configured');
  const state = historyState(deps.context);
  if (state !== 'ok') return fail(state === 'missing' ? 'no-git' : 'no-history');
  const history = deps.context.plugin<HistoryService>(HISTORY_PLUGIN) as HistoryService;
  try {
    await history.commitNow(); // what changed since the last auto-commit goes up too
    await history.idle();
    const binary = await findGitBinary({ gitBinary: deps.gitBinary, env: deps.gitEnv });
    if (!binary) return fail('no-git');
    const result = await pushVaultHistory({
      binary,
      root: deps.context.vault.root,
      remoteUrl: github.remoteUrl as string,
      branch: github.branch,
      token: github.token as string,
      env: deps.gitEnv,
      exec: deps.exec,
      platform: deps.platform,
      signal: deps.signal,
    });
    if (result.ok) {
      deps.logger.info('GitHub push done.');
      return { at, ok: true };
    }
    deps.logger.warn(`GitHub push failed (${result.error}).`);
    return fail(result.error);
  } catch (error) {
    deps.logger.warn(`GitHub push failed (${errorCodeOf(error)}).`);
    return fail('failed');
  }
}
