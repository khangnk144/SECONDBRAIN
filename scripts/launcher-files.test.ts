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

  it('holds launcher.lock while installing, building and starting', () => {
    const ps = read('start-second-brain.ps1').toString('utf8');
    expect(ps).toContain("Join-Path $StateDir 'launcher.lock'");
    expect(ps).toContain('[System.IO.FileMode]::CreateNew');
    expect(ps).toContain('$LockMaxAgeMinutes = 15');
    expect(ps).toContain('$OtherLauncherWaitSeconds = 600');
    expect(ps).toMatch(/if \(-not \(Enter-LauncherLock\)\) \{\r\n\s+Wait-ForOtherLauncher/);
    expect(ps).toMatch(/finally \{\r\n\s+Exit-LauncherLock/);
    const locked = ps.slice(ps.indexOf('function Start-SecondBrainLocked'));
    expect(locked).toContain("@('install'");
    expect(locked).toContain("@('run', 'build')");
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
