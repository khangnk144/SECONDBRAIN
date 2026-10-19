import { spawn } from 'node:child_process';
import path from 'node:path';

/** How to show a file in the OS file manager; always an argument array, never a shell line. */
export interface RevealCommand {
  command: string;
  args: string[];
  /** Windows only: pass the arguments exactly as written (Explorer parses its own quoting). */
  windowsVerbatimArguments?: boolean;
}

/** Launches a reveal command; tests inject one that records the call instead. */
export type RevealSpawner = (command: RevealCommand) => void;

export interface RevealOptions {
  spawn?: RevealSpawner;
  platform?: NodeJS.Platform;
  /** Launch problems (missing file manager); code only, never the path. */
  onError?: (code: string) => void;
}

/**
 * - Windows: `explorer.exe /select,"<path>"`. Node would quote the whole argument (Explorer then
 *   misreads it), so it is passed verbatim with the path in quotes; Windows paths cannot contain
 *   `"`, so the quoting cannot be broken, and spaces and commas stay inside it.
 * - macOS: `open -R <path>` selects the item in Finder.
 * - Elsewhere: `xdg-open <parent folder>` (there is no portable "select").
 */
export function revealCommand(platform: NodeJS.Platform, absolutePath: string): RevealCommand {
  if (platform === 'win32') {
    return {
      command: 'explorer.exe',
      args: [`/select,"${absolutePath}"`],
      windowsVerbatimArguments: true,
    };
  }
  if (platform === 'darwin') return { command: 'open', args: ['-R', absolutePath] };
  return { command: 'xdg-open', args: [path.dirname(absolutePath)] };
}

/** Starts the file manager detached from the server; its exit code is irrelevant. */
export function spawnDetached(onError: (code: string) => void): RevealSpawner {
  return ({ command, args, windowsVerbatimArguments }) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
      ...(windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}),
    });
    child.on('error', (error: NodeJS.ErrnoException) => onError(error.code ?? 'unknown'));
    child.unref();
  };
}
