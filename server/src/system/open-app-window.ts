/**
 * Opens Second Brain in its own window (owner request after trying the .exe: "it opens the web").
 * On Windows, in order:
 *   1. the installed app (PWA) – a Start menu shortcut "Second Brain" with `--app-id=` for this
 *      port (same rule as the launcher's `Find-InstalledAppShortcut`); a second launch focuses it;
 *   2. Microsoft Edge (always on Windows 10/11), else Google Chrome, in app mode
 *      (`--app=<url>`): a window without tabs or address bar;
 *   3. the default browser, as before.
 * Other systems open the default browser. Runs in a hidden Windows PowerShell; never throws.
 */
import { spawn } from 'node:child_process';
import { spawnDetached } from '../api/reveal-command.js';
import { openUrlCommand } from '../reminders/windows-toast.js';
import { windowsPowerShellPath } from './exe-problem.js';
import { encodePowerShellCommand } from './startup-shortcut-script.js';

export const DEFAULT_APP_PORT = 4747;

/** Browsers that support `--app=`; Edge first (part of Windows), then Chrome (machine, user). */
const APP_MODE_BROWSERS = [
  '${env:ProgramFiles(x86)}\\Microsoft\\Edge\\Application\\msedge.exe',
  '${env:ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe',
  '${env:LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe',
  '${env:ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe',
  '${env:ProgramFiles(x86)}\\Google\\Chrome\\Application\\chrome.exe',
  '${env:LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe',
];

/** The PowerShell script (ASCII only; the port is a validated integer). */
export function openAppWindowScript(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('port');
  const url = `http://localhost:${port}/`;
  const browsers = APP_MODE_BROWSERS.map((file) => `  "${file}"`).join(',\r\n');
  return [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$url = '${url}'`,
    `$port = ${port}`,
    "$programs = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'",
    '$shell = New-Object -ComObject WScript.Shell',
    "foreach ($name in @('Second Brain.lnk', 'Chrome Apps\\Second Brain.lnk', 'Edge Apps\\Second Brain.lnk')) {",
    '  $link = Join-Path $programs $name',
    '  if (-not (Test-Path -LiteralPath $link)) { continue }',
    '  $arguments = [string]$shell.CreateShortcut($link).Arguments',
    "  if ($arguments -notmatch '--app-id=') { continue }",
    '  if ($arguments -match \'--app-url=("?)(http://[^"\\s]+)\') {',
    '    if (-not $Matches[2].StartsWith($url)) { continue }',
    `  } elseif ($port -ne ${DEFAULT_APP_PORT}) { continue }`,
    '  Start-Process -FilePath $link',
    '  exit 0',
    '}',
    '$browsers = @(',
    browsers,
    ')',
    'foreach ($browser in $browsers) {',
    '  if (Test-Path -LiteralPath $browser) {',
    '    Start-Process -FilePath $browser -ArgumentList ("--app=" + $url)',
    '    exit 0',
    '  }',
    '}',
    'Start-Process $url',
    '',
  ].join('\r\n');
}

/** Launches a detached process; tests inject one that records the call. */
export type AppWindowSpawner = (command: string, args: string[]) => void;

const spawnHidden: AppWindowSpawner = (command, args) => {
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // Opening a window is a convenience: the app keeps running either way.
  }
};

export interface OpenAppWindowOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: AppWindowSpawner;
}

export function openAppWindow(port: number, options: OpenAppWindowOptions = {}): void {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    spawnDetached(() => undefined)(openUrlCommand(platform, `http://localhost:${port}/`));
    return;
  }
  (options.spawn ?? spawnHidden)(windowsPowerShellPath(options.env ?? process.env), [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    encodePowerShellCommand(openAppWindowScript(port)),
  ]);
}
