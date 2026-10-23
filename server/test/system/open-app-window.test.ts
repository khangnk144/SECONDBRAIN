import { describe, expect, it } from 'vitest';
import { openAppWindow, openAppWindowScript } from '../../src/system/open-app-window.js';

const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');

describe('opening the app in its own window (owner request after the first .exe)', () => {
  it('prefers the installed app of this port, then Edge or Chrome in app mode, then the browser', () => {
    const script = openAppWindowScript(4747);
    const installed = script.indexOf("$arguments -notmatch '--app-id='");
    const appMode = script.indexOf('("--app=" + $url)');
    const browser = script.lastIndexOf('Start-Process $url');
    expect(installed).toBeGreaterThan(-1);
    expect(appMode).toBeGreaterThan(installed);
    expect(browser).toBeGreaterThan(appMode);
    expect(script).toContain("$url = 'http://localhost:4747/'");
    expect(script).toContain('Microsoft\\Edge\\Application\\msedge.exe');
    expect(script).toContain('Google\\Chrome\\Application\\chrome.exe');
    // A PWA installed for another port is skipped, like the launcher does.
    expect(script).toContain('if (-not $Matches[2].StartsWith($url)) { continue }');
    expect([...script].every((char) => char.charCodeAt(0) < 0x80)).toBe(true);
  });

  it('refuses a port that is not a port (the value is written into the script)', () => {
    expect(() => openAppWindowScript(0)).toThrow(RangeError);
    expect(() => openAppWindowScript(4747.5)).toThrow(RangeError);
  });

  it('runs the script in a hidden Windows PowerShell, encoded (no quoting on a command line)', () => {
    const calls: { command: string; args: string[] }[] = [];
    openAppWindow(4800, {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      spawn: (command, args) => calls.push({ command, args }),
    });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(call!.args.slice(0, 7)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-WindowStyle',
      'Hidden',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
    ]);
    expect(decode(call!.args[7]!)).toBe(openAppWindowScript(4800));
  });

  it('does not use PowerShell outside Windows', () => {
    const calls: unknown[] = [];
    openAppWindow(4747, { platform: 'linux', spawn: (...args) => calls.push(args) });
    expect(calls).toHaveLength(0);
  });
});
