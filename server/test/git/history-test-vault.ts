import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAppContext, type AppContext } from '../../src/app-context/create-app-context.js';
import { HISTORY_PLUGIN } from '../../src/app-context/vault-plugins.js';
import { createHistoryPlugin, type HistoryPluginOptions } from '../../src/git/history-plugin.js';
import type { HistoryService } from '../../src/git/history-types.js';
import type { AppLogger } from '../../src/logging/rotating-file-logger.js';
import { makeSettings, makeTempDir, removeDir } from '../helpers/test-environment.js';
import { isolatedGitEnv } from './git-test-env.js';

export interface HistoryTestVault {
  home: string;
  root: string;
  context: AppContext;
  logger: AppLogger & { lines: string[] };
  /** Starts the history plugin the way the vault host does and attaches it to the context. */
  startHistory(options?: HistoryPluginOptions): Promise<HistoryService>;
  close(): Promise<void>;
}

function memoryLogger(): AppLogger & { lines: string[] } {
  const lines: string[] = [];
  return {
    file: null,
    lines,
    info: (message) => lines.push(`INFO ${message}`),
    warn: (message) => lines.push(`WARN ${message}`),
    error: (message) => lines.push(`ERROR ${message}`),
  };
}

/** A real vault context (no watcher) on a temp home with spaces and Vietnamese letters. */
export async function openHistoryTestVault(
  options: { seed?: (vaultRoot: string) => void; port?: number } = {},
): Promise<HistoryTestVault> {
  const home = makeTempDir('sb lịch sử Ghi chú');
  if (options.seed) {
    mkdirSync(path.join(home, 'vault'));
    options.seed(path.join(home, 'vault'));
  }
  const settings = makeSettings({ port: options.port ?? 47630 });
  const logger = memoryLogger();
  const context = await createAppContext({ home, settings, logger, watcher: false });
  return {
    home,
    root: context.vault.root,
    context,
    logger,
    async startHistory(pluginOptions = {}) {
      const plugin = createHistoryPlugin(pluginOptions);
      const service = await plugin.start({
        context,
        settings: () => settings,
        port: settings.port,
        logger,
      });
      context.attachPlugin(HISTORY_PLUGIN, service);
      return service;
    },
    async close() {
      await context.close();
      removeDir(home);
    },
  };
}

export const SEEDED_NOTE = '0 Inbox/Ghi chú.md';

export interface SeededHistoryVault {
  vault: HistoryTestVault;
  git: ReturnType<typeof isolatedGitEnv>;
  env: NodeJS.ProcessEnv;
  dispose(): Promise<void>;
}

/**
 * A vault that starts with one note (so a later edit of it changes exactly one file) and an
 * isolated git environment; `seed` may add more before the vault opens.
 */
export async function openSeededHistoryVault(
  seed?: (root: string, env: NodeJS.ProcessEnv) => void,
): Promise<SeededHistoryVault> {
  const git = isolatedGitEnv();
  const vault = await openHistoryTestVault({
    seed: (root) => {
      mkdirSync(path.join(root, '0 Inbox'));
      writeFileSync(path.join(root, ...SEEDED_NOTE.split('/')), 'Bản gốc\n');
      seed?.(root, git.env);
    },
  });
  return {
    vault,
    git,
    env: git.env,
    async dispose() {
      await vault.close();
      git.dispose();
    },
  };
}

/** Writes (or creates) a note through the vault, then waits until git is idle. */
export async function editNote(
  vault: HistoryTestVault,
  service: HistoryService,
  text: string,
  notePath = SEEDED_NOTE,
): Promise<void> {
  const { context } = vault;
  if (!(await context.vault.stat(notePath))) await context.vault.create(notePath, text);
  else await context.vault.write(notePath, text, (await context.vault.read(notePath)).revision);
  // The indexer then logs the edit in `events.jsonl` (`note_edited`, F35.9); wait for it so the
  // next commit holds the note and that line together, never a second state-only commit.
  await context.settled();
  await service.idle();
}
