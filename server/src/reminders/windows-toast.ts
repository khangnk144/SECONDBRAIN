/**
 * Delivers a reminder toast (SPEC F17): Windows PowerShell 5.1 + WinRT first, `node-notifier`
 * if that fails, `failed` if both do. Other platforms answer `unsupported` without starting a
 * process (open windows still show the reminder). Logs carry codes only, never toast text.
 */
import { spawn } from 'node:child_process';
import { spawnDetached, type RevealCommand } from '../api/reveal-command.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import type { ToastContent } from './reminder-messages.js';
import type { ToastOutcome } from './reminder-types.js';
import { loadNodeNotifierToaster, notifyWithToaster, type LoadToaster } from './notifier-toast.js';
import { powerShellToastInvocation } from './toast-script.js';

export interface ToastDeliverer {
  /** Whether this machine can show server toasts at all. */
  readonly supported: boolean;
  deliver(toast: ToastContent): Promise<ToastOutcome>;
}

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  /** Spawn failure (`ENOENT`…), when the process never ran. */
  errorCode?: string;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  timeoutMs: number,
) => Promise<ProcessResult>;

export const TOAST_TIMEOUT_MS = 15_000;

const errorCode = (error: unknown) =>
  (error as NodeJS.ErrnoException | null)?.code ?? 'spawn-failed';

/** Runs a process without a console window or shell; killed after `timeoutMs`. */
export const runHiddenProcess: ProcessRunner = (command, args, timeoutMs) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = (result: ProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      // Invalid arguments throw synchronously instead of emitting 'error'.
      resolve({ exitCode: null, timedOut: false, errorCode: errorCode(error) });
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
      finish({ exitCode: null, timedOut: true });
    }, timeoutMs);
    child.on('error', (error) =>
      finish({ exitCode: null, timedOut: false, errorCode: errorCode(error) }),
    );
    child.on('exit', (code) => finish({ exitCode: code, timedOut: false }));
  });

/**
 * Opens a URL in the default browser the way "reveal" opens Explorer: an argument array, no
 * shell. On Windows `explorer.exe "<url>"` hands it to the protocol handler; the URL is
 * percent-encoded, so it holds no quote that could break the verbatim argument.
 */
export function openUrlCommand(platform: NodeJS.Platform, url: string): RevealCommand {
  if (platform === 'win32')
    return { command: 'explorer.exe', args: [`"${url}"`], windowsVerbatimArguments: true };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

export interface WindowsToastOptions {
  logger: AppLogger;
  platform?: NodeJS.Platform;
  run?: ProcessRunner;
  loadToaster?: LoadToaster;
  openUrl?: (url: string) => void;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

function describe(result: ProcessResult): string {
  if (result.errorCode) return result.errorCode;
  return result.timedOut ? 'timeout' : `exit ${result.exitCode}`;
}

export function createWindowsToastDeliverer(options: WindowsToastOptions): ToastDeliverer {
  const platform = options.platform ?? process.platform;
  const { logger } = options;
  const run = options.run ?? runHiddenProcess;
  const loadToaster = options.loadToaster ?? loadNodeNotifierToaster;
  const timeoutMs = options.timeoutMs ?? TOAST_TIMEOUT_MS;
  const openUrl =
    options.openUrl ??
    ((url: string) =>
      spawnDetached((code) => logger.warn(`Opening a reminder link failed (${code}).`))(
        openUrlCommand(platform, url),
      ));
  const supported = platform === 'win32';

  async function viaNotifier(toast: ToastContent): Promise<ToastOutcome> {
    try {
      const toaster = await loadToaster();
      const outcome = await notifyWithToaster(toaster, toast, { openUrl, shownAfterMs: timeoutMs });
      if (outcome === 'failed') logger.warn('Reminder toast: node-notifier failed too.');
      return outcome;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code ?? 'load-failed';
      logger.warn(`Reminder toast: node-notifier unavailable (${code}).`);
      return 'failed';
    }
  }

  return {
    supported,
    async deliver(toast) {
      if (!supported) return 'unsupported';
      const { command, args } = powerShellToastInvocation(toast, options.env);
      const result = await run(command, args, timeoutMs);
      if (result.exitCode === 0) return 'shown';
      logger.warn(`Reminder toast: PowerShell failed (${describe(result)}); trying node-notifier.`);
      return viaNotifier(toast);
    },
  };
}
