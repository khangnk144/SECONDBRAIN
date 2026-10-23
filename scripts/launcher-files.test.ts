// Static checks for the Windows launcher files (they cannot run in CI, so their encoding and
// the key branches are asserted here).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRoot } from './lib/script-utils.js';

const launcherDir = path.join(appRoot, 'launcher');
const read = (name: string) => readFileSync(path.join(launcherDir, name));
const hasOnlyCrlf = (text: string) => !/(^|[^\r])\n/.test(text) && text.includes('\r\n');

describe('launcher files', () => {
  for (const name of ['Mở Second Brain.cmd', 'root-wrapper.cmd']) {
    it(`${name} is ASCII with CRLF line endings and starts the PowerShell script`, () => {
      const bytes = read(name);
      expect([...bytes].every((b) => b < 0x80)).toBe(true);
      const text = bytes.toString('utf8');
      expect(hasOnlyCrlf(text)).toBe(true);
      expect(text.startsWith('@echo off')).toBe(true);
      expect(text).toContain('chcp 65001');
      expect(text).toContain('-NoProfile -ExecutionPolicy Bypass -File');
      expect(text).toMatch(/%\*\r\n/);
      expect(text).toMatch(/if errorlevel 1 \(\r\n\s+echo\.\r\n\s+pause/);
    });
  }

  it('points each wrapper at the script relative to its own folder', () => {
    expect(read('Mở Second Brain.cmd').toString()).toContain('"%~dp0start-second-brain.ps1"');
    expect(read('root-wrapper.cmd').toString()).toContain(
      '"%~dp0app\\launcher\\start-second-brain.ps1"',
    );
  });

  it('start-second-brain.ps1 is UTF-8 with BOM and CRLF line endings', () => {
    const bytes = read('start-second-brain.ps1');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(hasOnlyCrlf(bytes.toString('utf8'))).toBe(true);
  });

  it('start-second-brain.ps1 covers start, health check, hidden server, build and stop', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain("param([string]$Action = 'start')");
    expect(ps).toMatch(/http:\/\/127\.0\.0\.1:\$Port\/api\/health/);
    expect(ps).toContain("'second-brain'");
    expect(ps).toContain("$startArgs['WindowStyle'] = 'Hidden'");
    expect(ps).toContain("ArgumentList = @('server/dist/index.js')");
    expect(ps).toContain('WorkingDirectory = $AppDir');
    expect(ps).toContain("@('run', 'build')");
    expect(ps).toContain("@('install'");
    expect(ps).toContain('https://nodejs.org');
    expect(ps).toContain("[Version]'22.12.0'");
    expect(ps).toMatch(/'stop' \{ Stop-SecondBrain \}/);
    expect(ps).toContain("Join-Path $SbHome '.secondbrain'");
    expect(ps).toContain("'server.json'");
    // $HOME and $PID are read-only automatic variables in PowerShell.
    expect(ps).not.toMatch(/\$(home|pid)\s*=/i);
  });

  it('stop asks the server to shut down first and only force-stops our own node process', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain('-Method Post -Uri "http://127.0.0.1:$Port/api/shutdown"');
    expect(ps).toContain("@{ 'X-SB-Token' = $token }");
    expect(ps).toContain("Get-JsonProperty (Read-JsonFile $SettingsFile) 'sessionToken'");
    expect(ps).toContain('Wait-AppStopped $Port 10');
    expect(ps).toContain('Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId"');
    expect(ps).toContain("-match 'server[\\\\/]dist[\\\\/]index\\.js'");
    const stopBody = ps.slice(ps.indexOf('function Stop-SecondBrain'));
    // The forced stop happens only after the graceful request and the command-line check.
    expect(stopBody.indexOf('Request-GracefulShutdown')).toBeLessThan(
      stopBody.indexOf('Test-IsOurServer'),
    );
    expect(stopBody.indexOf('Test-IsOurServer')).toBeLessThan(stopBody.indexOf('Stop-Process'));
  });

  it('(F29.1) the forced stop also recognises the single executable as our server', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    const check = ps.slice(
      ps.indexOf('function Test-IsOurServer'),
      ps.indexOf('function Stop-SecondBrain'),
    );
    // The node, exe and helper patterns as written in the script (.NET -match ignores case).
    const patterns = [...check.matchAll(/-(?:not)?match '([^']+)'/g)].map((m) => m[1] ?? '');
    expect(patterns).toHaveLength(3);
    const [, exe = '', helper = ''] = patterns;
    const isOurServer = (commandLine: string) =>
      /server[\\/]dist[\\/]index\.js/i.test(commandLine) ||
      (new RegExp(exe, 'i').test(commandLine) && !new RegExp(helper, 'i').test(commandLine));
    for (const server of [
      '"C:\\Program Files\\nodejs\\node.exe" server/dist/index.js',
      '"D:\\SECONDBRAIN\\Second Brain.exe"',
      '"D:\\SECONDBRAIN\\Second Brain.exe" --login',
      '"D:\\Đồ án\\Second Brain.exe" --login --home "D:\\Đồ án"',
      '/home/lan/second-brain --home /home/lan/Ghi chú',
    ]) {
      expect(isOurServer(server), server).toBe(true);
    }
    for (const other of [
      '"D:\\SECONDBRAIN\\Second Brain.exe" --mcp-stdio',
      '"D:\\SECONDBRAIN\\Second Brain.exe" --stop',
      '"C:\\Windows\\notepad.exe" "D:\\SECONDBRAIN\\Second Brain.exe"',
      '"C:\\Tools\\Second Brain Helper.exe"',
      'node /home/lan/second-brain.js',
    ]) {
      expect(isOurServer(other), other).toBe(false);
    }
  });

  it('holds launcher.lock while installing, building and starting', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain("Join-Path $StateDir 'launcher.lock'");
    expect(ps).toContain('[System.IO.FileMode]::CreateNew');
    expect(ps).toContain('$LockMaxAgeMinutes = 15');
    expect(ps).toContain('$OtherLauncherWaitSeconds = 600');
    // Without the lock (start mode) the launcher waits for the other one instead of starting.
    expect(ps).toMatch(
      /if \(-not \(Enter-LauncherLock\)\) \{(\r\n\s+(#[^\r]*|if \(\$LoginMode\) \{ return \}))*\r\n\s+Wait-ForOtherLauncher\r\n\s+return/,
    );
    expect(ps).toMatch(/finally \{\r\n\s+Exit-LauncherLock/);
    const locked = ps.slice(ps.indexOf('function Start-SecondBrainLocked'));
    expect(locked).toContain("@('install'");
    expect(locked).toContain("@('run', 'build')");
  });

  it('login starts the same way, never opens a browser and stays silent when running (F18.6)', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain('start-second-brain.ps1 login');
    expect(ps).toContain("$LoginMode = ($Action -eq 'login')");
    expect(ps).toMatch(/'login' \{ Start-SecondBrain \}/);
    expect(ps).toContain('Dùng: start, stop hoặc login.');
    expect(ps).toMatch(
      /function Open-App\(\[int\]\$Port\) \{\r\n\s+if \(\$LoginMode\) \{ return \}/,
    );
    const start = ps.slice(ps.indexOf('function Start-SecondBrain {'));
    // Already running at sign-in: nothing to do or show; another launcher starting it: leave it be.
    expect(start).toMatch(
      /if \(Test-AppHealth \$port\) \{\r\n\s+#[^\r]*\r\n\s+if \(\$LoginMode\) \{ return \}/,
    );
    expect(start).toMatch(
      /if \(-not \(Enter-LauncherLock\)\) \{\r\n\s+#[^\r]*\r\n\s+if \(\$LoginMode\) \{ return \}/,
    );
    // A launcher that waited for the lock checks again before starting a second node process.
    const afterLock = start.slice(start.indexOf('try {'));
    expect(afterLock.indexOf('Test-AppHealth $port')).toBeGreaterThan(-1);
    expect(afterLock.indexOf('Test-AppHealth $port')).toBeLessThan(
      afterLock.indexOf('Start-SecondBrainLocked'),
    );
  });

  it('reports failures in launcher.log and one message box (always for a busy port)', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain("$LauncherLogFile = Join-Path $StateDir 'logs/launcher.log'");
    expect(ps).toContain('[System.Windows.Forms.MessageBox]::Show($owner, $Message, $AppTitle,');
    const stop = ps.slice(ps.indexOf('function Stop-WithProblem'));
    expect(stop.slice(0, stop.indexOf('exit 1'))).toMatch(
      /Write-LauncherLog[\s\S]*if \(\$LoginMode -or \$Dialog\) \{[\s\S]*Show-MessageBox \$text/,
    );
    // Node missing or too old takes the same path (a message box in login mode).
    const node = ps.slice(
      ps.indexOf('function Assert-Node'),
      ps.indexOf('function Test-BuildNeeded'),
    );
    expect(node.match(/Stop-WithProblem/g)).toHaveLength(2);
    expect(node).not.toMatch(/\bexit\b/);
    expect(ps).toMatch(/\} catch \{\r\n\s+Stop-WithProblem "Có lỗi: /);
  });

  it('names the program holding the port when the server exits with code 2 (F21.4)', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain('$ExitPortBusy = 2');
    expect(ps).toContain('if ($server.HasExited -and $server.ExitCode -eq $ExitPortBusy) {');
    expect(ps).toContain(
      'Stop-WithProblem (Get-PortBusyMessage $port (Get-PortOwnerName $port)) -Dialog',
    );
    expect(ps).toContain('Get-NetTCPConnection -LocalPort $Port -State Listen');
    expect(ps).toContain('[int]$listener.OwningProcess');
    expect(ps).toContain('$process = Get-Process -Id $ownerPid');
    expect(ps).toContain('& netstat.exe -ano -p TCP');
    expect(ps).toContain(
      'Cổng $Port đang bị $who dùng. Đóng chương trình đó, hoặc đổi cổng trong Cài đặt của Second Brain rồi mở lại.',
    );
    expect(ps).toContain("$who = 'một chương trình khác'");
  });

  it('opens the installed app when its Start menu shortcut exists, else the browser', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    const find = ps.slice(ps.indexOf('function Find-InstalledAppShortcut'));
    expect(find).toContain("Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'");
    for (const shortcut of [
      "'Second Brain.lnk'",
      "'Chrome Apps\\Second Brain.lnk'",
      "'Edge Apps\\Second Brain.lnk'",
    ]) {
      expect(find).toContain(shortcut);
    }
    expect(find).toContain('New-Object -ComObject WScript.Shell');
    expect(find).toContain("if ($arguments -notmatch '--app-id=') { continue }");
    expect(find).toContain('StartsWith("http://localhost:$Port/")');
    // A shortcut without --app-url (Chrome) is trusted only on the default port.
    expect(find).toMatch(
      /\} elseif \(\$Port -ne \$DefaultPort\) \{(\r\n\s+#[^\r]*)*\r\n\s+continue/,
    );
    expect(ps).toContain(
      'if ($null -ne $shortcut) { Start-Process -FilePath $shortcut } else { Start-Process $url }',
    );
  });

  it('start-hidden.vbs is ASCII with CRLF and starts the login action hidden, without waiting', () => {
    const bytes = read('start-hidden.vbs');
    expect([...bytes].every((b) => b < 0x80)).toBe(true);
    const text = bytes.toString('utf8');
    expect(hasOnlyCrlf(text)).toBe(true);
    expect(text).toContain('Option Explicit');
    expect(text).toContain('fso.GetParentFolderName(WScript.ScriptFullName)');
    expect(text).toContain('fso.BuildPath(folder, "start-second-brain.ps1")');
    expect(text).toContain(
      'command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ login"',
    );
    expect(text).toContain('Set shell = CreateObject("WScript.Shell")');
    expect(text).toMatch(/^shell\.Run command, 0, False\r$/m);
  });

  it('git keeps CRLF for the Windows scripts', () => {
    const attributes = readFileSync(path.join(appRoot, '.gitattributes'), 'utf8');
    for (const pattern of ['*.cmd', '*.ps1', '*.vbs']) {
      expect(attributes).toContain(`${pattern} text eol=crlf`);
    }
  });

  it('uses only Windows PowerShell 5.1 syntax', () => {
    const code = read('start-second-brain.ps1')
      .toString('utf8')
      .split('\r\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    for (const pwsh7Only of [
      '??',
      '?.',
      ' && ',
      ' || ',
      '-AsHashtable',
      '-Parallel',
      '-SkipCertificateCheck',
      'Test-Json',
      '$IsWindows',
    ]) {
      expect(code, pwsh7Only).not.toContain(pwsh7Only);
    }
  });
});
