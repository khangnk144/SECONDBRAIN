/**
 * Shows why the executable cannot start (F29.1). Windows: one message box from Windows
 * PowerShell 5.1, detached so this process can exit with its code while the box stays; the
 * text is a single-quoted literal inside `-EncodedCommand` (no quoting issue with paths or
 * Vietnamese letters). Elsewhere, and always in addition: stderr.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { encodePowerShellCommand, powerShellLiteral } from './startup-shortcut-script.js';

export type DetachedSpawner = (command: string, args: string[]) => void;

export function messageBoxScript(text: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.Windows.Forms',
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    `$null = [System.Windows.Forms.MessageBox]::Show($owner, ${powerShellLiteral(text)}, 'Second Brain', ` +
      '[System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Warning)',
    '$owner.Dispose()',
    '',
  ].join('\r\n');
}

export function windowsPowerShellPath(env: NodeJS.ProcessEnv): string {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.windir;
  return systemRoot
    ? path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell.exe';
}

const spawnDetachedHidden: DetachedSpawner = (command, args) => {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => undefined);
  child.unref();
};

export interface ProblemOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: DetachedSpawner;
  stderr?: (text: string) => void;
}

export function showProblem(text: string, options: ProblemOptions = {}): void {
  (options.stderr ?? ((line: string) => process.stderr.write(line)))(`${text}\n`);
  if ((options.platform ?? process.platform) !== 'win32') return;
  const env = options.env ?? process.env;
  (options.spawn ?? spawnDetachedHidden)(windowsPowerShellPath(env), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShellCommand(messageBoxScript(text)),
  ]);
}
