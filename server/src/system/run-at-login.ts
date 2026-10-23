import { lstat, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runtimeInfo } from './runtime-info.js';
import {
  buildCreateShortcutScript,
  createPowerShellRunner,
  encodePowerShellCommand,
  type PowerShellRunner,
} from './startup-shortcut-script.js';

/** File name of our shortcut in the Startup folder; the only file this service ever removes. */
export const STARTUP_SHORTCUT_NAME = 'Second Brain.lnk';

/**
 * "Chạy khi đăng nhập Windows" (SPEC F18): a Startup-folder shortcut to the hidden launcher, or
 * to `"<exe>" --login` when the app runs as the single executable (F29.4).
 */
export interface RunAtLoginService {
  /** Windows with a known Startup folder. */
  readonly supported: boolean;
  /** Whether the shortcut file exists (the truth `GET /settings` reports). */
  isEnabled(): Promise<boolean>;
  /** Creates or removes the shortcut; throws when Windows refused (code in the error). */
  setEnabled(enabled: boolean): Promise<void>;
}

export interface RunAtLoginOptions {
  /** The app folder (`<home>/app`): the shortcut starts `<appDir>\launcher\start-hidden.vbs`. */
  appDir: string;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** Overrides `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup` (tests). */
  startupDir?: string;
  /** Runs the PowerShell that creates the `.lnk` (tests pass a fake creator). */
  runPowerShell?: PowerShellRunner;
  /** The executable to start (default: `SB_EXE_PATH` in exe mode, else the launcher). */
  exePath?: string | null;
}

export function defaultStartupFolder(env: NodeJS.ProcessEnv): string | null {
  const appData = env.APPDATA;
  if (!appData) return null;
  return path.win32.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await lstat(file)).isFile();
  } catch {
    return false;
  }
}

export function createRunAtLoginService(options: RunAtLoginOptions): RunAtLoginService {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const startupDir = options.startupDir ?? defaultStartupFolder(env);
  const supported = platform === 'win32' && startupDir !== null;
  const shortcutPath = startupDir ? path.join(startupDir, STARTUP_SHORTCUT_NAME) : null;
  const run = options.runPowerShell ?? createPowerShellRunner(env);
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? 'C:\\Windows';
  const exePath = options.exePath === undefined ? runtimeInfo(env).exePath : options.exePath;

  async function create(file: string): Promise<void> {
    // Exe: `--login` starts silently (no browser). Launcher: its hidden mode, where wscript runs
    // the .vbs with no console window and no browser.
    const script = buildCreateShortcutScript(
      exePath
        ? {
            shortcutPath: file,
            targetPath: exePath,
            arguments: '--login',
            workingDirectory: path.win32.dirname(exePath),
            description: 'Second Brain',
          }
        : {
            shortcutPath: file,
            targetPath: path.win32.join(systemRoot, 'System32', 'wscript.exe'),
            arguments: `"${path.win32.join(options.appDir, 'launcher', 'start-hidden.vbs')}"`,
            workingDirectory: options.appDir,
            description: 'Second Brain',
          },
    );
    await mkdir(path.dirname(file), { recursive: true });
    await run(encodePowerShellCommand(script));
    if (!(await isFile(file)))
      throw Object.assign(new Error('shortcut missing'), { code: 'ENOLNK' });
  }

  return {
    supported,
    async isEnabled() {
      return supported && shortcutPath !== null && isFile(shortcutPath);
    },
    async setEnabled(enabled) {
      if (!supported || !shortcutPath) {
        if (enabled) throw Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' });
        return;
      }
      if (enabled) return create(shortcutPath);
      try {
        await unlink(shortcutPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
