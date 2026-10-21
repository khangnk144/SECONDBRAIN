/**
 * The per-vault history plugin (SPEC F20.3): finds git, prepares the vault's repository, then
 * auto-commits every 10 minutes and once more on close (server shutdown, vault switch). Without
 * git, or when the repository cannot be prepared, it still starts – as a service that answers
 * `available: false` – and nothing else in the app is affected.
 */
import { errorCodeOf } from '../app-context/app-context-errors.js';
import { HISTORY_PLUGIN, type VaultPlugin } from '../app-context/vault-plugins.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { lastCommit } from './commit-vault-changes.js';
import { findGitBinary } from './find-git-binary.js';
import { createGitHistoryService } from './git-history-service.js';
import { createGitRunner } from './git-runner.js';
import {
  HistoryUnavailableError,
  type HistoryService,
  type HistoryUnavailableReason,
} from './history-types.js';
import { prepareVaultRepository } from './prepare-vault-repository.js';

const MINUTE_MS = 60_000;

export interface HistoryTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface HistoryPluginOptions {
  /** Only this git binary is tried (tests: a bogus name simulates "git missing"). */
  gitBinary?: string;
  platform?: NodeJS.Platform;
  /** Extra environment for every git command (tests isolate HOME and the global config). */
  env?: NodeJS.ProcessEnv;
  /** Clock for the stale-lock check. */
  now?: () => Date;
  timers?: HistoryTimers;
  autoCommitMs?: number;
  /** An `index.lock` older than this is left over from a crashed git and removed. */
  lockStaleMs?: number;
  /** How long close() waits for the final commit before it lets the shutdown go on. */
  closeTimeoutMs?: number;
}

const realTimers: HistoryTimers = {
  setInterval: (callback, ms) => {
    const handle = setInterval(callback, ms);
    handle.unref?.(); // never keeps the process alive on its own
    return handle;
  },
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

/** A service that answers "no history" and does nothing else. */
export function unavailableHistoryService(reason: HistoryUnavailableReason): HistoryService {
  const refuse = () => Promise.reject(new HistoryUnavailableError(reason));
  return {
    status: () => ({ available: false, reason, lastCommitAt: null }),
    noteHistory: refuse,
    noteVersion: refuse,
    restore: refuse,
    commitNow: () => Promise.resolve(null),
    idle: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
}

function waitAtMost(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    void work.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** Adds the auto-commit timer and the bounded on-close commit around a git-backed service. */
function withAutoCommit(
  service: HistoryService,
  options: HistoryPluginOptions,
  logger: AppLogger,
): HistoryService {
  const timers = options.timers ?? realTimers;
  let running = false;
  const handle = timers.setInterval(
    () => {
      if (running) return; // a slow commit is still going: skip this beat
      running = true;
      void service.commitNow().finally(() => {
        running = false;
      });
    },
    options.autoCommitMs ?? 10 * MINUTE_MS,
  );
  let closing: Promise<void> | null = null;
  return {
    ...service,
    close() {
      closing ??= (async () => {
        timers.clearInterval(handle);
        const closed = service.close().catch((error: unknown) => {
          logger.warn(`History: final commit failed (${errorCodeOf(error)}).`);
        });
        await waitAtMost(closed, options.closeTimeoutMs ?? 10_000);
      })();
      return closing;
    },
  };
}

export function createHistoryPlugin(
  options: HistoryPluginOptions = {},
): VaultPlugin<HistoryService> {
  return {
    name: HISTORY_PLUGIN,
    async start({ context, logger }) {
      const binary = await findGitBinary(options);
      if (!binary) {
        logger.info('History: git was not found; version history is off.');
        return unavailableHistoryService('git-missing');
      }
      const root = context.vault.root;
      const git = createGitRunner({ binary, root, platform: options.platform, env: options.env });
      let created: boolean;
      let last: Awaited<ReturnType<typeof lastCommit>>;
      try {
        created = await prepareVaultRepository(git, root);
        last = await lastCommit(git);
      } catch (error) {
        logger.warn(`History: preparing the git repository failed (${errorCodeOf(error)}).`);
        return unavailableHistoryService('init-failed');
      }
      const service = createGitHistoryService({
        context,
        git,
        logger,
        now: options.now ?? (() => new Date()),
        lockStaleMs: options.lockStaleMs ?? 10 * MINUTE_MS,
        lastCommitAt: last?.date ?? null,
      });
      // The first commit of a new repository runs in the background: a big vault must not
      // delay the server start.
      if (created) void service.commitNow();
      return withAutoCommit(service, options, logger);
    },
  };
}
