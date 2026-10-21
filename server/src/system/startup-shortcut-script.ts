import { execFile } from 'node:child_process';
import path from 'node:path';

/** Runs one Windows PowerShell script given as `-EncodedCommand` text; tests inject a fake. */
export type PowerShellRunner = (encodedCommand: string) => Promise<void>;

/**
 * A single-quoted PowerShell literal. Inside single quotes only quote characters are special,
 * and PowerShell treats the typographic ones (‘ ’ ‚ ‛) like `'`, so each of them is doubled too.
 * Paths with spaces, Vietnamese letters, `$` or backticks therefore pass through unchanged.
 */
export function powerShellLiteral(value: string): string {
  return `'${value.replace(/['‘’‚‛]/g, (quote) => quote + quote)}'`;
}

/** `-EncodedCommand` takes the script as base64 of its UTF-16LE bytes (no quoting issues at all). */
export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64');
}

export interface ShortcutSpec {
  shortcutPath: string;
  targetPath: string;
  arguments: string;
  workingDirectory: string;
  description: string;
}

/** Creates (or replaces) a `.lnk` file with the `WScript.Shell` COM object. */
export function buildCreateShortcutScript(spec: ShortcutSpec): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$shell = New-Object -ComObject WScript.Shell',
    `$link = $shell.CreateShortcut(${powerShellLiteral(spec.shortcutPath)})`,
    `$link.TargetPath = ${powerShellLiteral(spec.targetPath)}`,
    `$link.Arguments = ${powerShellLiteral(spec.arguments)}`,
    `$link.WorkingDirectory = ${powerShellLiteral(spec.workingDirectory)}`,
    `$link.Description = ${powerShellLiteral(spec.description)}`,
    '$link.Save()',
    '',
  ].join('\r\n');
}

const POWERSHELL_TIMEOUT_MS = 15_000;

/** Windows PowerShell 5.1 (always present on Windows 10/11), never through a shell. */
export function createPowerShellRunner(env: NodeJS.ProcessEnv = process.env): PowerShellRunner {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
  const executable = systemRoot
    ? path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
  return (encodedCommand) =>
    new Promise((resolve, reject) => {
      execFile(
        executable,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          encodedCommand,
        ],
        { windowsHide: true, timeout: POWERSHELL_TIMEOUT_MS, shell: false },
        (error) => (error ? reject(error) : resolve()),
      );
    });
}
