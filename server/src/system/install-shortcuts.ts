/**
 * First start of the executable (F29.4): "Second Brain.lnk" on the Desktop and in the Start
 * menu, pointing at the exe, created once per exe path and recorded in
 * `<home>/.secondbrain/install.json`; never in source mode or off Windows. Folder locations come
 * from Windows itself (a Desktop moved to OneDrive included). A shortcut of the installed app
 * (PWA, `--app-id=` in its arguments) with the same name is never replaced. When "Chạy khi đăng
 * nhập" is on, its Startup shortcut is pointed at the exe at the same moment.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import type { RunAtLoginService } from './run-at-login.js';
import {
  createPowerShellRunner,
  encodePowerShellCommand,
  powerShellLiteral,
  type PowerShellRunner,
} from './startup-shortcut-script.js';

export const SHORTCUT_FILE_NAME = 'Second Brain.lnk';

export interface InstallRecord {
  version: 1;
  exePath: string;
  shortcutsAt: string;
}

export function buildInstallShortcutsScript(exePath: string): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    '$shell = New-Object -ComObject WScript.Shell',
    `$exe = ${powerShellLiteral(exePath)}`,
    "foreach ($folder in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {",
    '  if ([string]::IsNullOrEmpty($folder)) { continue }',
    `  $file = Join-Path $folder ${powerShellLiteral(SHORTCUT_FILE_NAME)}`,
    '  if (Test-Path -LiteralPath $file) {',
    '    # The installed app (PWA) may use the same name: never replace it.',
    "    if ([string]$shell.CreateShortcut($file).Arguments -match '--app-id=') { continue }",
    '  }',
    '  $link = $shell.CreateShortcut($file)',
    '  $link.TargetPath = $exe',
    "  $link.Arguments = ''",
    '  $link.WorkingDirectory = Split-Path -Parent $exe',
    '  $link.IconLocation = "$exe,0"',
    "  $link.Description = 'Second Brain'",
    '  $link.Save()',
    '}',
    '',
  ].join('\r\n');
}

export const installRecordPath = (home: string) => path.join(home, '.secondbrain', 'install.json');

export async function readInstallRecord(home: string): Promise<InstallRecord | null> {
  try {
    const record = JSON.parse(await readFile(installRecordPath(home), 'utf8')) as InstallRecord;
    return record.version === 1 && typeof record.exePath === 'string' ? record : null;
  } catch {
    return null;
  }
}

export interface InstallShortcutsOptions {
  home: string;
  exePath: string;
  runAtLogin?: RunAtLoginService;
  platform?: NodeJS.Platform;
  runPowerShell?: PowerShellRunner;
  now?: () => Date;
}

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** (Re)creates both shortcuts and records it; throws when PowerShell failed. */
export async function createInstallShortcuts(options: InstallShortcutsOptions): Promise<void> {
  if ((options.platform ?? process.platform) !== 'win32') {
    throw Object.assign(new Error('unsupported'), { code: 'EUNSUPPORTED' });
  }
  const run = options.runPowerShell ?? createPowerShellRunner();
  await run(encodePowerShellCommand(buildInstallShortcutsScript(options.exePath)));
  if (options.runAtLogin && (await options.runAtLogin.isEnabled())) {
    await options.runAtLogin.setEnabled(true); // re-written with the exe as its target
  }
  const record: InstallRecord = {
    version: 1,
    exePath: options.exePath,
    shortcutsAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  await atomicWriteFile(installRecordPath(options.home), `${JSON.stringify(record, null, 2)}\n`);
}

/** Once per exe path: `created`, or `recorded` when install.json already names this exe. */
export async function ensureInstallShortcuts(
  options: InstallShortcutsOptions,
): Promise<'created' | 'recorded' | 'unsupported'> {
  if ((options.platform ?? process.platform) !== 'win32') return 'unsupported';
  const record = await readInstallRecord(options.home);
  if (record && samePath(record.exePath, options.exePath)) return 'recorded';
  await createInstallShortcuts(options);
  return 'created';
}
