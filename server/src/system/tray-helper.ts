/**
 * The tray helper's lifecycle (F29.2): `launcher/tray/second-brain-tray.ps1` runs hidden in
 * Windows PowerShell 5.1 while Settings "Biểu tượng khay và phím tắt" (`system.tray`, default
 * on) is on, in exe and launcher mode alike; never elsewhere. One helper per server. The token,
 * port, parent pid, texts and icon travel in the environment only, never on the command line.
 * The helper ends when its stdin closes (asked here, or the server process is gone) and also
 * watches the parent pid. A helper that dies is restarted at most 3 times per hour; a language
 * change restarts it with the new texts. Its one stdout line tells whether Ctrl+Alt+Q is ours.
 */
import type { VaultPlugin } from '../app-context/vault-plugins.js';
import type { GlobalSettings } from '../config/global-settings.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { windowsPowerShellPath } from './exe-problem.js';
import {
  defaultTraySpawner,
  readStatusLine,
  trayArguments,
  trayEnvironment,
  trayIconPath,
  trayScriptPath,
  wantsTray,
  type TrayChild,
  type TraySpawner,
} from './tray-launch.js';
import type { TrayLanguage } from './tray-strings.js';

export type { TrayChild, TraySpawner } from './tray-launch.js';

export const TRAY_HOTKEY = 'Ctrl+Alt+Q';
export const MAX_RESTARTS_PER_HOUR = 3;
export type TrayState = 'running' | 'off' | 'unsupported' | 'failed';
export interface TrayStatus {
  state: TrayState;
  hotkey: typeof TRAY_HOTKEY;
  /** From the helper's status line; null until it reported (or when it is not running). */
  hotkeyRegistered: boolean | null;
}

export interface TrayHelperOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: TraySpawner;
  now?: () => number;
  restartDelayMs?: number;
  watchMs?: number;
  stopTimeoutMs?: number;
  parentPid?: number;
}

export interface TrayHelper {
  /** Hands the live settings and the logger over when a vault opens (the helper outlives it). */
  readonly plugin: VaultPlugin;
  /** Watches the settings from now on; starts the helper when wanted. */
  start(target: { port: number; appDir: string }): void;
  stop(): Promise<void>;
  status(): TrayStatus;
}

export function createTrayHelper(options: TrayHelperOptions = {}): TrayHelper {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const spawnChild = options.spawn ?? defaultTraySpawner;
  const now = options.now ?? Date.now;
  let settings: (() => GlobalSettings) | null = null;
  let logger: AppLogger | null = null;
  let target: { port: number; appDir: string } | null = null;
  let child: TrayChild | null = null;
  let language: TrayLanguage = 'vi';
  let state: TrayState = platform === 'win32' ? 'off' : 'unsupported';
  let hotkeyRegistered: boolean | null = null;
  let restarts: number[] = [];
  let watch: NodeJS.Timeout | null = null;
  let restartTimer: NodeJS.Timeout | null = null;
  let switching: Promise<void> | null = null;
  let stopping = false;

  const wanted = () =>
    platform === 'win32' && !stopping && settings !== null && wantsTray(settings());

  function launch(): void {
    if (!settings || !target) return;
    const current = settings();
    language = current.ui.language;
    const childEnv = trayEnvironment(env, {
      token: current.sessionToken,
      port: target.port,
      parentPid: options.parentPid ?? process.pid,
      language,
      icon: trayIconPath(target.appDir),
    });
    const proc = spawnChild(
      windowsPowerShellPath(env),
      trayArguments(trayScriptPath(target.appDir)),
      childEnv,
    );
    child = proc;
    state = 'running';
    hotkeyRegistered = null;
    readStatusLine(proc.stdout, (registered) => {
      if (child === proc) hotkeyRegistered = registered;
    });
    proc.stderr?.resume();
    let exited = false;
    const onExit = (code: number | null) => {
      if (exited) return;
      exited = true;
      exitedUnexpectedly(proc, code);
    };
    proc.on('error', (error) => {
      logger?.warn(
        `Tray helper could not run (${(error as NodeJS.ErrnoException).code ?? 'error'}).`,
      );
      onExit(null);
    });
    proc.on('exit', onExit);
  }

  function exitedUnexpectedly(proc: TrayChild, code: number | null): void {
    if (child !== proc) return; // stopped on purpose (it was detached from `child` first)
    child = null;
    hotkeyRegistered = null;
    if (!wanted()) {
      if (state !== 'unsupported') state = 'off';
      return;
    }
    restarts = restarts.filter((time) => time > now() - 3_600_000);
    if (restarts.length >= MAX_RESTARTS_PER_HOUR) {
      state = 'failed';
      logger?.warn(`Tray helper exited (code ${code}) too often within an hour; not restarted.`);
      return;
    }
    restarts.push(now());
    logger?.warn(`Tray helper exited (code ${code}); restarting it.`);
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (wanted() && !child && !switching) launch();
    }, options.restartDelayMs ?? 2000);
    restartTimer.unref?.();
  }

  /** Closes the helper's stdin (it removes its icon and exits), then kills it after a while. */
  function end(proc: TrayChild): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        proc.kill();
        resolve();
      }, options.stopTimeoutMs ?? 3000);
      proc.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      proc.stdin?.end();
    });
  }

  function detachAndEnd(after?: () => void): void {
    const proc = child;
    child = null;
    hotkeyRegistered = null;
    if (!proc) return;
    switching = end(proc).then(() => {
      switching = null;
      after?.();
    });
  }

  function tick(): void {
    if (stopping || !settings || !target || switching) return;
    if (!wanted()) {
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      detachAndEnd();
      if (state !== 'unsupported') state = 'off';
      restarts = [];
      return;
    }
    if (state === 'failed') return; // until the switch is turned off and on again
    if (child && settings().ui.language !== language) {
      detachAndEnd(() => (wanted() ? launch() : undefined));
      return;
    }
    if (!child && !restartTimer) launch();
  }

  return {
    plugin: {
      name: 'tray',
      async start(host) {
        settings = host.settings;
        logger = host.logger;
        return { close: async () => undefined };
      },
    },
    start(next) {
      if (platform !== 'win32' || watch) return;
      target = next;
      tick();
      watch = setInterval(tick, options.watchMs ?? 1000);
      watch.unref?.();
    },
    async stop() {
      stopping = true;
      if (watch) clearInterval(watch);
      if (restartTimer) clearTimeout(restartTimer);
      watch = restartTimer = null;
      const proc = child;
      child = null;
      await Promise.all([switching, proc ? end(proc) : null]);
      if (state !== 'unsupported') state = 'off';
    },
    status: () => ({ state, hotkey: TRAY_HOTKEY, hotkeyRegistered }),
  };
}
