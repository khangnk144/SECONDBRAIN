import path from 'node:path';
import type { VaultInfo } from '../config/settings-response.js';
import type { SettingsStore } from '../config/settings-store.js';
import { isSameFolder } from '../config/vault-location.js';
import { ApiError } from '../http/api-errors.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { createWebSocketHub, type WebSocketHub } from '../ws/websocket-hub.js';
import { errorCodeOf } from './app-context-errors.js';
import { createAppContext, type AppContext, type AppContextOptions } from './create-app-context.js';
import { createDelegatingContext } from './delegating-app-context.js';
import { createRequestGate, type RequestGate } from './request-gate.js';
import type { VaultPlugin } from './vault-plugins.js';
import { checkSwitchTarget, vaultUnusable } from './vault-switch-target.js';

/** How long a switch lets running requests finish before it closes the vault anyway. */
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000;

export interface VaultHostOptions {
  /** Install root; the default vault is `<home>/vault`. */
  home: string;
  appDir?: string;
  settings: SettingsStore;
  logger: AppLogger;
  /** Port the server listens on (plugins build deep links with it). */
  port: number;
  /** Per-vault background services, started for every vault that opens (in this order). */
  plugins?: readonly VaultPlugin[];
  contextOptions?: Pick<AppContextOptions, 'now' | 'watcher' | 'faults'>;
  drainTimeoutMs?: number;
}

export interface VaultSwitchResult {
  vaultId: string;
  path: string;
}

/** Owns the open vault: its context, the shared WebSocket hub, the plugins and the switch. */
export interface VaultHost {
  /** Stable context for routes; every member resolves to the open vault at call time. */
  readonly context: AppContext;
  /** The real context of the open vault. */
  readonly current: AppContext;
  readonly hub: WebSocketHub;
  readonly gate: RequestGate;
  /** The app and global-state folders no vault (or restore target) may overlap. */
  readonly protectedDirs: readonly string[];
  vaultInfo(): VaultInfo;
  /** Opens another vault (`null` = `<home>/vault`); on failure the previous one is reopened. */
  switchTo(target: string | null): Promise<VaultSwitchResult>;
  close(): Promise<void>;
}

export async function openVaultHost(options: VaultHostOptions): Promise<VaultHost> {
  const { home, logger, settings } = options;
  const hub = createWebSocketHub();
  const gate = createRequestGate();
  const plugins = options.plugins ?? [];
  const defaultRoot = path.join(home, 'vault');
  const protectedDirs = [path.join(home, '.secondbrain'), path.join(home, 'app')];
  if (options.appDir) protectedDirs.push(options.appDir);

  async function startPlugins(context: AppContext): Promise<void> {
    for (const plugin of plugins) {
      try {
        const instance = await plugin.start({
          context,
          settings: settings.get,
          port: options.port,
          logger,
        });
        context.attachPlugin(plugin.name, instance);
      } catch (error) {
        logger.warn(`The ${plugin.name} plugin did not start (${errorCodeOf(error)}).`);
      }
    }
  }

  async function open(vaultPath: string | null): Promise<{ context: AppContext; info: VaultInfo }> {
    const context = await createAppContext({
      home,
      appDir: options.appDir,
      settings: { vaultPath },
      logger,
      hub,
      ...options.contextOptions,
    });
    try {
      await startPlugins(context);
      const root = context.vault.root;
      const isDefault = await isSameFolder(root, defaultRoot);
      return {
        context,
        info: { path: root, id: context.vault.id, isDefault, defaultPath: defaultRoot },
      };
    } catch (error) {
      await context.close();
      throw error;
    }
  }

  let { context: current, info } = await open(settings.get().vaultPath);
  let switching: Promise<unknown> | null = null;
  let closing: Promise<void> | null = null;

  const result = (): VaultSwitchResult => ({ vaultId: info.id, path: info.path });

  async function replace(vaultPath: string | null): Promise<VaultSwitchResult> {
    const previous = info.path;
    // Plugins first, then queued writes, watcher and index. A failure is logged: the switch
    // goes on (or reopens this vault), never leaving the server without one.
    await current
      .close()
      .catch((error: unknown) =>
        logger.error(`Closing the vault before a switch failed (${errorCodeOf(error)}).`),
      );
    try {
      ({ context: current, info } = await open(vaultPath));
    } catch (error) {
      logger.error(
        `Opening the chosen vault failed (${errorCodeOf(error)}); reopening the previous one.`,
      );
      try {
        ({ context: current, info } = await open(previous));
      } catch (reopenError) {
        logger.error(`Reopening the previous vault failed (${errorCodeOf(reopenError)}).`);
      }
      throw vaultUnusable('open-failed');
    }
    // Only a vault that opened is remembered for the next start.
    const stored = info.isDefault ? null : vaultPath;
    await settings
      .update((draft) => {
        draft.vaultPath = stored;
      })
      .catch((error: unknown) =>
        logger.error(`Saving the vault folder in the settings failed (${errorCodeOf(error)}).`),
      );
    logger.info(`Switched to vault ${info.id}.`);
    hub.broadcast({ type: 'vault:switched', vaultId: info.id });
    return result();
  }

  async function switchTo(target: string | null): Promise<VaultSwitchResult> {
    if (target !== null && !path.isAbsolute(target)) {
      throw new ApiError(400, 'VALIDATION', 'Choose a full folder path.', {
        field: 'path',
        reason: 'not-absolute',
      });
    }
    const folder = path.resolve(target ?? defaultRoot);
    if (await isSameFolder(folder, info.path)) return result();
    await checkSwitchTarget(folder, {
      allowMissing: target === null,
      protectedDirs,
      openVault: info.path,
    });
    await gate.close(options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS);
    try {
      return await replace(target === null ? null : folder);
    } finally {
      gate.open();
    }
  }

  const host: VaultHost = {
    context: createDelegatingContext({
      current: () => current,
      hub,
      logger,
      close: () => host.close(),
    }),
    get current() {
      return current;
    },
    hub,
    gate,
    protectedDirs,
    vaultInfo: () => ({ ...info }),
    switchTo(target) {
      if (switching || closing) {
        return Promise.reject(
          new ApiError(409, 'CONFLICT', 'Another vault switch is still running.', {
            reason: 'switch-in-progress',
          }),
        );
      }
      const run = switchTo(target).finally(() => {
        switching = null;
      });
      switching = run;
      return run;
    },
    close() {
      closing ??= (async () => {
        await switching?.catch(() => undefined);
        await current.close();
      })();
      return closing;
    },
  };
  return host;
}
