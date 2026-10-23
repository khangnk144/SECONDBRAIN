// Static checks for the Windows-only files of the single executable (F29.2, F29.3, F29.5): the
// tray helper script and "Tạo bản exe.cmd" cannot run in CI (no Windows PowerShell here).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { appRoot } from './lib/script-utils.js';

const read = (rel: string) => readFileSync(path.join(appRoot, rel));
const hasOnlyCrlf = (text: string) => !/(^|[^\r])\n/.test(text) && text.includes('\r\n');
const tray = () => read('launcher/tray/second-brain-tray.ps1').toString('utf8');
/** The script without comment lines and the comment block at the top. */
const trayCode = () =>
  tray()
    .replace(/<#[\s\S]*?#>/, '')
    .split('\r\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

describe('tray helper script (F29.2, F29.3)', () => {
  it('is ASCII with CRLF line endings (every visible text comes from the server)', () => {
    const bytes = read('launcher/tray/second-brain-tray.ps1');
    expect([...bytes].every((byte) => byte < 0x80)).toBe(true);
    expect(hasOnlyCrlf(bytes.toString('utf8'))).toBe(true);
  });

  it('(F29.2) reads the token from the environment only and drops it from there at once', () => {
    const code = trayCode();
    expect(code).toContain('$Token = [string]$env:SB_TOKEN');
    expect(code).toContain('Remove-Item Env:SB_TOKEN');
    expect(code).not.toMatch(/\bparam\s*\(\s*\[string\]\$Token/i);
    expect(code).not.toMatch(/\$args\b/);
    for (const name of ['SB_PORT', 'SB_PARENT_PID', 'SB_TRAY_STRINGS', 'SB_ICON']) {
      expect(code).toContain(`$env:${name}`);
    }
  });

  it('(F29.2) the menu opens the app, captures and quits through POST /api/shutdown', () => {
    const code = trayCode();
    expect(code).toContain('New-Object System.Windows.Forms.NotifyIcon');
    expect(code).toContain('$menu.Items.Add($Strings.open)');
    expect(code).toContain('$menu.Items.Add($Strings.capture)');
    expect(code).toContain('$menu.Items.Add($Strings.quit)');
    expect(code).toContain("Invoke-SecondBrainPost '/api/shutdown' '{}'");
    expect(code).toContain('$Strings.quitConfirm');
  });

  it('(F29.2, F29.3) every request carries X-SB-Token and the canonical Origin', () => {
    const code = trayCode();
    expect(code).toContain('$ApiBase = "http://127.0.0.1:$Port"');
    expect(code).toContain('$Origin = "http://localhost:$Port"');
    expect(code).toContain("$request.Headers.Add('X-SB-Token', $Token)");
    expect(code).toContain("$request.Headers.Add('Origin', $Origin)");
    expect(code).toContain("Invoke-SecondBrainPost '/api/capture' $json");
    expect(code).toContain('[System.Text.Encoding]::UTF8.GetBytes($Json)');
  });

  it('(F29.3) registers Ctrl+Alt+Q with RegisterHotKey and unregisters it on exit', () => {
    const code = trayCode();
    expect(code).toContain('static extern bool RegisterHotKey(');
    expect(code).toContain('UnregisterHotKey(Handle, HotkeyId)');
    expect(code).toContain('const int WM_HOTKEY = 0x0312;');
    expect(code).toContain('$ModControl = 0x2');
    expect(code).toContain('$ModAlt = 0x1');
    expect(code).toContain('$KeyQ = 0x51');
    expect(code).toContain(
      '$script:Hotkey.Register($ModControl -bor $ModAlt -bor $ModNoRepeat, $KeyQ)',
    );
    const stop = code.slice(code.indexOf('function Stop-Helper'));
    expect(stop.slice(0, stop.indexOf('\n}'))).toContain('$script:Hotkey.Dispose()');
    expect(code).toContain(
      `'{"hotkeyRegistered":' + $(if ($registered) { 'true' } else { 'false' }) + '}'`,
    );
  });

  it('(F29.3) the capture box: Enter saves, Shift+Enter is a new line, Esc closes, text kept on failure', () => {
    const code = trayCode();
    expect(code).toContain(
      '$keyArgs.KeyCode -eq [System.Windows.Forms.Keys]::Enter -and -not $keyArgs.Shift',
    );
    expect(code).toContain('$keyArgs.SuppressKeyPress = $true');
    expect(code).toContain('$form.CancelButton = $closeButton');
    expect(code).toContain('$form.TopMost = $true');
    const save = code.slice(
      code.indexOf('function Save-Capture'),
      code.indexOf('function Invoke-SaveCapture'),
    );
    expect(save).toContain('if ($code -eq 201)');
    expect(save).toContain('$Strings.saved');
    // On failure the box stays open with the text; only success closes it.
    expect(save.match(/CaptureForm\.Close\(\)/g)).toHaveLength(1);
    expect(save).not.toMatch(/CaptureText\.(Text\s*=|Clear\()/);
    expect(save).toContain('$Strings.offline');
  });

  it('(F29.2) leaves when stdin closes or the server process is gone (checked every 5 s)', () => {
    const code = trayCode();
    expect(code).toContain('[Console]::OpenStandardInput()');
    expect(code).toContain('$script:StdinRead.Result -le 0');
    expect(code).toContain('($script:Ticks % 5) -eq 0 -and -not (Test-ParentAlive)');
    expect(code).toContain('Get-Process -Id $ParentPid -ErrorAction SilentlyContinue');
    expect(code).toContain('"Local\\SecondBrainTray-$Port"');
  });

  it('uses only Windows PowerShell 5.1 syntax and no closures bound to another scope', () => {
    // The C# hotkey window (a here-string for Add-Type) is not PowerShell.
    const code = trayCode().replace(/@'\n[\s\S]*?\n'@/, '');
    expect(code).toContain('Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition');
    for (const pwsh7Only of [
      '??',
      '?.',
      ' && ',
      ' || ',
      '-AsHashtable',
      '-Parallel',
      '$IsWindows',
    ]) {
      expect(code, pwsh7Only).not.toContain(pwsh7Only);
    }
    expect(code).not.toContain('GetNewClosure');
    expect(code).not.toMatch(/\bWrite-(Output|Host)\b/); // stdout carries the status line only
  });
});

describe('"Tạo bản exe.cmd" (F29.1, F29.5)', () => {
  const file = 'launcher/Tạo bản exe.cmd';
  it('is UTF-8 without BOM, CRLF, switches the console to UTF-8 before any Vietnamese text', () => {
    const bytes = read(file);
    expect([...bytes.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    const text = bytes.toString('utf8');
    expect(hasOnlyCrlf(text)).toBe(true);
    expect(text.startsWith('@echo off\r\nchcp 65001 >nul\r\n')).toBe(true);
    const firstNonAscii = [...bytes].findIndex((byte) => byte >= 0x80);
    expect(firstNonAscii).toBeGreaterThan(text.indexOf('chcp 65001'));
  });

  it('builds with npm run build:exe, copies the exe next to the app folder, pauses on errors', () => {
    const text = read(file).toString('utf8');
    expect(text).toContain('for %%I in ("%~dp0..\\..") do set "HOME_DIR=%%~fI"');
    expect(text).toContain('call npm run build:exe');
    expect(text).toContain('copy /y "%APP_DIR%\\dist-exe\\%EXE_NAME%" "%HOME_DIR%\\%EXE_NAME%"');
    expect(text).toContain('set "EXE_NAME=Second Brain.exe"');
    expect(text).toMatch(/:failed\r\n[\s\S]*pause\r\nexit \/b 1/);
    // F29.5: the unsigned exe and SmartScreen.
    expect(text).toContain('"Thông tin bổ sung" rồi "Vẫn chạy"');
  });

  it('has no parentheses in echo lines inside ( ) blocks (cmd would end the block there)', () => {
    let depth = 0;
    for (const line of read(file).toString('utf8').split('\r\n')) {
      const trimmed = line.trim();
      if (depth > 0 && /^echo\b/i.test(trimmed)) expect(trimmed, line).not.toMatch(/[()]/);
      if (trimmed.endsWith('(')) depth += 1;
      if (trimmed === ')') depth -= 1;
    }
    expect(depth).toBe(0);
  });

  it('git ignores the build output', () => {
    expect(read('.gitignore').toString('utf8')).toMatch(/^dist-exe\/$/m);
  });
});
