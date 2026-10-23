import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildInstallShortcutsScript,
  ensureInstallShortcuts,
  installRecordPath,
  readInstallRecord,
} from '../../src/system/install-shortcuts.js';
import type { RunAtLoginService } from '../../src/system/run-at-login.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';

const decode = (encoded: string) => Buffer.from(encoded, 'base64').toString('utf16le');
const EXE = "D:\\SECONDBRAIN Đồ án\\Khang's\\Second Brain.exe";
const homes: string[] = [];
afterEach(() => homes.splice(0).forEach(removeDir));

function fakeRunAtLogin(enabled: boolean) {
  const calls: boolean[] = [];
  const service: RunAtLoginService = {
    supported: true,
    isEnabled: async () => enabled,
    setEnabled: async (value) => void calls.push(value),
  };
  return { service, calls };
}

describe('Desktop and Start-menu shortcuts on the first exe start (F29.4)', () => {
  it('(F29.4) the script asks Windows for both folders, targets the exe, never replaces the PWA', () => {
    const script = buildInstallShortcutsScript(EXE);
    expect(script).toContain("[Environment]::GetFolderPath('Desktop')");
    expect(script).toContain("[Environment]::GetFolderPath('Programs')");
    expect(script).toContain("Join-Path $folder 'Second Brain.lnk'");
    expect(script).toContain("$exe = 'D:\\SECONDBRAIN Đồ án\\Khang''s\\Second Brain.exe'");
    expect(script).toContain('$link.TargetPath = $exe');
    expect(script).toContain("-match '--app-id='");
    expect(script).toContain('$link.IconLocation = "$exe,0"');
    expect(script.split('\r\n').length).toBeGreaterThan(10);
  });

  it('(F29.4) creates them once, records install.json, again only for another exe path', async () => {
    const home = makeTempDir('sb install Cài đặt');
    homes.push(home);
    const scripts: string[] = [];
    const runAtLogin = fakeRunAtLogin(false);
    const options = {
      home,
      exePath: EXE,
      platform: 'win32' as const,
      runAtLogin: runAtLogin.service,
      runPowerShell: async (encoded: string) => void scripts.push(decode(encoded)),
      now: () => new Date('2026-10-22T08:00:00.000Z'),
    };
    expect(await ensureInstallShortcuts(options)).toBe('created');
    expect(await readInstallRecord(home)).toEqual({
      version: 1,
      exePath: EXE,
      shortcutsAt: '2026-10-22T08:00:00.000Z',
    });
    expect(await ensureInstallShortcuts(options)).toBe('recorded');
    expect(await ensureInstallShortcuts({ ...options, exePath: EXE.toUpperCase() })).toBe(
      'recorded',
    );
    expect(scripts).toHaveLength(1);
    expect(runAtLogin.calls).toEqual([]); // run at login was off: left alone
    expect(
      await ensureInstallShortcuts({ ...options, exePath: 'E:\\Other\\Second Brain.exe' }),
    ).toBe('created');
    expect(scripts).toHaveLength(2);
  });

  it('(F29.4) points an enabled "Chạy khi đăng nhập" at the exe at the same time', async () => {
    const home = makeTempDir();
    homes.push(home);
    const runAtLogin = fakeRunAtLogin(true);
    await ensureInstallShortcuts({
      home,
      exePath: EXE,
      platform: 'win32',
      runAtLogin: runAtLogin.service,
      runPowerShell: async () => undefined,
    });
    expect(runAtLogin.calls).toEqual([true]);
  });

  it('records nothing when Windows refused (tried again next start), nothing off Windows', async () => {
    const home = makeTempDir();
    homes.push(home);
    const failing = {
      home,
      exePath: EXE,
      platform: 'win32' as const,
      runPowerShell: async () => {
        throw Object.assign(new Error('blocked'), { code: 'EPERM' });
      },
    };
    await expect(ensureInstallShortcuts(failing)).rejects.toMatchObject({ code: 'EPERM' });
    expect(existsSync(installRecordPath(home))).toBe(false);
    const scripts: string[] = [];
    expect(
      await ensureInstallShortcuts({
        home,
        exePath: '/opt/second-brain',
        platform: 'linux',
        runPowerShell: async (encoded) => void scripts.push(encoded),
      }),
    ).toBe('unsupported');
    expect(scripts).toEqual([]);
  });
});
