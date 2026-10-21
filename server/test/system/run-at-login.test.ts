import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRunAtLoginService,
  defaultStartupFolder,
  STARTUP_SHORTCUT_NAME,
} from '../../src/system/run-at-login.js';
import {
  buildCreateShortcutScript,
  encodePowerShellCommand,
  powerShellLiteral,
} from '../../src/system/startup-shortcut-script.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');
const APP_DIR = "D:\\SECONDBRAIN Đồ án\\app's ‘copy’";

describe('PowerShell quoting for the Startup shortcut', () => {
  it('single-quoted literals double every quote character PowerShell treats as one', () => {
    expect(powerShellLiteral('C:\\Program Files\\x')).toBe("'C:\\Program Files\\x'");
    expect(powerShellLiteral("it's")).toBe("'it''s'");
    expect(powerShellLiteral('a‘b’c‚d‛e')).toBe("'a‘‘b’’c‚‚d‛‛e'");
    // `$`, backticks and double quotes have no meaning inside single quotes.
    expect(powerShellLiteral('$env:x `n "y"')).toBe('\'$env:x `n "y"\'');
  });

  it('the encoded command is the UTF-16LE script and decodes back exactly', () => {
    const script = buildCreateShortcutScript({
      shortcutPath: 'C:\\Users\\Khang\\Startup\\Second Brain.lnk',
      targetPath: 'C:\\Windows\\System32\\wscript.exe',
      arguments: `"${APP_DIR}\\launcher\\start-hidden.vbs"`,
      workingDirectory: APP_DIR,
      description: 'Second Brain',
    });
    expect(decode(encodePowerShellCommand(script))).toBe(script);
    expect(script).toContain(
      "$link = $shell.CreateShortcut('C:\\Users\\Khang\\Startup\\Second Brain.lnk')",
    );
    expect(script).toContain(
      "$link.Arguments = '\"D:\\SECONDBRAIN Đồ án\\app''s ‘‘copy’’\\launcher\\start-hidden.vbs\"'",
    );
    expect(script).toContain("$link.WorkingDirectory = 'D:\\SECONDBRAIN Đồ án\\app''s ‘‘copy’’'");
    expect(script).toContain('$link.Save()');
  });

  it('the Startup folder comes from %APPDATA%', () => {
    expect(defaultStartupFolder({ APPDATA: 'C:\\Users\\Khang\\AppData\\Roaming' })).toBe(
      'C:\\Users\\Khang\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
    );
    expect(defaultStartupFolder({})).toBeNull();
  });
});

describe('run at login creates and removes only our shortcut (F18.6)', () => {
  let root: string;
  let startupDir: string;
  beforeEach(() => {
    root = makeTempDir('sb startup Khởi động');
    startupDir = path.join(root, 'Start Menu', 'Programs', 'Startup');
    mkdirSync(startupDir, { recursive: true });
    writeFileSync(path.join(startupDir, 'Other app.lnk'), 'not ours');
  });
  afterEach(() => removeDir(root));

  function service(scripts: string[], options: { fail?: boolean } = {}) {
    return createRunAtLoginService({
      appDir: APP_DIR,
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' },
      startupDir,
      // A fake creator: what the real script would do is write the .lnk at the given path.
      runPowerShell: async (encoded) => {
        const script = decode(encoded);
        scripts.push(script);
        if (options.fail) throw Object.assign(new Error('blocked'), { code: 'EPERM' });
        const target = /CreateShortcut\('((?:[^']|'')*)'\)/.exec(script)![1]!.replace(/''/g, "'");
        writeFileSync(target, 'lnk');
      },
    });
  }

  it('creates "Second Brain.lnk" starting the hidden launcher, then removes just that file', async () => {
    const scripts: string[] = [];
    const runAtLogin = service(scripts);
    expect(runAtLogin.supported).toBe(true);
    expect(await runAtLogin.isEnabled()).toBe(false);
    await runAtLogin.setEnabled(true);
    expect(existsSync(path.join(startupDir, STARTUP_SHORTCUT_NAME))).toBe(true);
    expect(await runAtLogin.isEnabled()).toBe(true);
    expect(scripts[0]).toContain("$link.TargetPath = 'C:\\Windows\\System32\\wscript.exe'");
    expect(scripts[0]).toContain('launcher\\start-hidden.vbs');

    await runAtLogin.setEnabled(false);
    expect(await runAtLogin.isEnabled()).toBe(false);
    expect(readdirSync(startupDir)).toEqual(['Other app.lnk']);
    await runAtLogin.setEnabled(false); // already gone: nothing to do, no error
  });

  it('reports a failure when Windows refused and no shortcut appeared', async () => {
    const runAtLogin = service([], { fail: true });
    await expect(runAtLogin.setEnabled(true)).rejects.toMatchObject({ code: 'EPERM' });
    expect(await runAtLogin.isEnabled()).toBe(false);
  });

  it('is unsupported off Windows and never runs anything there', async () => {
    const scripts: string[] = [];
    const runAtLogin = createRunAtLoginService({
      appDir: APP_DIR,
      platform: 'linux',
      startupDir,
      runPowerShell: async (encoded) => {
        scripts.push(encoded);
      },
    });
    expect(runAtLogin.supported).toBe(false);
    expect(await runAtLogin.isEnabled()).toBe(false);
    await expect(runAtLogin.setEnabled(true)).rejects.toMatchObject({ code: 'EUNSUPPORTED' });
    await runAtLogin.setEnabled(false);
    expect(scripts).toEqual([]);
  });
});
