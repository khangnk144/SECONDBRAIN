import type { GlobalSettings } from '../config/global-settings.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import type { AppContext } from './create-app-context.js';

/**
 * Per-vault background services (reminder scheduler, git history). The host starts every plugin
 * right after a vault context opened and closes it before that context closes, so a plugin of
 * vault A never runs while vault B is open (vault switch, SPEC F18.3).
 */
export interface VaultPluginHost {
  /** The vault that just opened (never the switching proxy: it stays bound to this vault). */
  context: AppContext;
  /** Current global settings; read on every use, they change at runtime (PUT /settings). */
  settings: () => GlobalSettings;
  /** Port the server listens on (deep links in notifications). */
  port: number;
  logger: AppLogger;
}

export interface VaultPluginInstance {
  /** Stops timers and finishes pending work; must not throw. */
  close(): Promise<void>;
}

export interface VaultPlugin<T extends VaultPluginInstance = VaultPluginInstance> {
  /** Registry key, e.g. 'reminders', 'history'. Routes look the instance up by it. */
  readonly name: string;
  /** Starts the plugin for one vault. A failure is logged by the host and the vault still opens. */
  start(host: VaultPluginHost): Promise<T>;
}

/** Names used by routes to find their plugin on the current context. */
export const REMINDERS_PLUGIN = 'reminders';
export const HISTORY_PLUGIN = 'history';
